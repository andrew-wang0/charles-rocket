from __future__ import annotations

import contextlib
import csv
import importlib
import logging
import sys
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence, TextIO

from calibration import PressureCalibrationEntry, save_pressure_calibration
from config import (
    ADS1115_DATA_RATE,
    ADS1115_GAIN,
    ADS1115_I2C_ADDRESS,
    PRESSURE_RAW_WINDOW_SECONDS,
    PRESSURE_TRANSDUCER_CHANNELS,
    PRESSURE_TRANSDUCER_COUNT,
    PRESSURE_TRANSDUCER_MAX_PSI,
    PRESSURE_TRANSDUCER_MAX_VOLTAGE,
    PRESSURE_TRANSPORT_RATE_HZ,
    PRESSURE_TRANSPORT_WINDOW_SECONDS,
)

logger = logging.getLogger(__name__)
RASPBERRY_PI_SYSTEM_PACKAGES = Path("/usr/lib/python3/dist-packages")
TRANSPORT_SAMPLE_INTERVAL_SECONDS = 1 / PRESSURE_TRANSPORT_RATE_HZ
RAW_BUFFER_MAXLEN = PRESSURE_RAW_WINDOW_SECONDS * ADS1115_DATA_RATE
TRANSPORT_BUFFER_MAXLEN = PRESSURE_TRANSPORT_WINDOW_SECONDS * PRESSURE_TRANSPORT_RATE_HZ
THREAD_JOIN_TIMEOUT_SECONDS = 0.2
PRESSURE_READ_MAX_ATTEMPTS = 3
PRESSURE_READ_RETRY_DELAY_SECONDS = 0.002
PRESSURE_FAILURE_LOG_INTERVAL = 60
HISTORY_FILE_BUCKET_MS = 60 * 60 * 1000
DEFAULT_HISTORY_MAX_POINTS = 1_200


class PressureSampler:
    def __init__(self, calibration: Sequence[PressureCalibrationEntry] | None = None) -> None:
        self.available = False
        self.error: str | None = None

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._i2c: Any | None = None
        self._ads: Any | None = None
        self._channels: list[Any] = []
        self._sensor_ok = [False] * PRESSURE_TRANSDUCER_COUNT
        self._consecutive_failures = [0] * PRESSURE_TRANSDUCER_COUNT
        self._last_transport_sample_times = [0.0] * PRESSURE_TRANSDUCER_COUNT
        self._raw_buffers = [
            deque(maxlen=RAW_BUFFER_MAXLEN) for _ in range(PRESSURE_TRANSDUCER_COUNT)
        ]
        self._transport_buffers = [
            deque(maxlen=TRANSPORT_BUFFER_MAXLEN) for _ in range(PRESSURE_TRANSDUCER_COUNT)
        ]
        self._zero_offsets = [
            calibration[index].zero if calibration else 0.0
            for index in range(PRESSURE_TRANSDUCER_COUNT)
        ]
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "pressure-transducers"
        self._file_handles: list[TextIO | None] = [None] * PRESSURE_TRANSDUCER_COUNT
        self._file_handle_buckets: list[int | None] = [None] * PRESSURE_TRANSDUCER_COUNT

        try:
            self._add_raspberry_pi_system_packages()

            board = importlib.import_module("board")
            busio = importlib.import_module("busio")
            ads1115_module = importlib.import_module("adafruit_ads1x15.ads1115")
            ads1x15_module = importlib.import_module("adafruit_ads1x15.ads1x15")
            analog_in_module = importlib.import_module("adafruit_ads1x15.analog_in")

            self._i2c = busio.I2C(board.SCL, board.SDA)
            self._ads = ads1115_module.ADS1115(
                self._i2c,
                address=ADS1115_I2C_ADDRESS,
                gain=ADS1115_GAIN,
                data_rate=ADS1115_DATA_RATE,
                mode=ads1x15_module.Mode.SINGLE,
            )

            self._channels = [
                analog_in_module.AnalogIn(self._ads, getattr(ads1x15_module.Pin, f"A{channel}"))
                for channel in PRESSURE_TRANSDUCER_CHANNELS
            ]

            self.available = True
            logger.info(
                "pressure sampler ready: address=0x%02x aggregate_rate=%sHz channels=%s",
                ADS1115_I2C_ADDRESS,
                ADS1115_DATA_RATE,
                PRESSURE_TRANSDUCER_CHANNELS,
            )
        except Exception as exc:
            self.error = str(exc)
            logger.exception("pressure sampler initialization failed")

    def _add_raspberry_pi_system_packages(self) -> None:
        package_path = str(RASPBERRY_PI_SYSTEM_PACKAGES)
        if RASPBERRY_PI_SYSTEM_PACKAGES.exists() and package_path not in sys.path:
            sys.path.append(package_path)

    def start(self) -> None:
        if not self.available:
            return

        if self._thread is not None and self._thread.is_alive():
            return

        self._data_dir.mkdir(parents=True, exist_ok=True)

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="pressure-sampler", daemon=True)
        self._thread.start()
        logger.info("pressure sampler started: data_dir=%s", self._data_dir)

    def stop(self) -> None:
        logger.info("pressure sampler stop requested")
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=THREAD_JOIN_TIMEOUT_SECONDS)
            self._thread = None

        for handle in self._file_handles:
            with contextlib.suppress(Exception):
                handle.flush()
                handle.close()

        self._file_handles = [None] * PRESSURE_TRANSDUCER_COUNT
        self._file_handle_buckets = [None] * PRESSURE_TRANSDUCER_COUNT

        if self._i2c is not None:
            with contextlib.suppress(Exception):
                self._i2c.deinit()
            self._i2c = None
        logger.info("pressure sampler stopped")

    def status_payload(self) -> list[bool]:
        with self._lock:
            return list(self._sensor_ok)

    def history_payload(
        self,
        start_time: int | None = None,
        end_time: int | None = None,
        max_points: int | None = None,
    ) -> list[list[dict[str, float | int]]]:
        should_query_files = start_time is not None or end_time is not None
        limit = max_points or DEFAULT_HISTORY_MAX_POINTS
        history = [
            self._read_data_files(index, start_time, end_time) if should_query_files else []
            for index in range(PRESSURE_TRANSDUCER_COUNT)
        ]

        with self._lock:
            for index, buffer in enumerate(self._transport_buffers):
                buffer_history = self._filter_history(list(buffer), start_time, end_time)
                history[index] = (
                    self._merge_history(history[index], buffer_history)
                    if should_query_files
                    else buffer_history
                )

        return [
            [
                {"time": timestamp_ms, "value": psi}
                for timestamp_ms, psi in self._downsample_history(readings, limit)
            ]
            for readings in history
        ]

    def latest_payload(self) -> list[list[dict[str, float | int]]]:
        with self._lock:
            return [
                []
                if not buffer
                else [{"time": buffer[-1][0], "value": buffer[-1][1]}]
                for buffer in self._raw_buffers
            ]

    def tare(self, channel_index: int) -> float:
        if channel_index < 0 or channel_index >= PRESSURE_TRANSDUCER_COUNT:
            raise ValueError("invalid_pressure_index")

        with self._lock:
            latest = self._raw_buffers[channel_index][-1] if self._raw_buffers[channel_index] else None
            if latest is None:
                raise ValueError("pressure_tare_unavailable")

            tare_value = latest[1]
            next_zero_offsets = list(self._zero_offsets)
            next_zero_offsets[channel_index] += tare_value

            next_calibration = [
                PressureCalibrationEntry(zero=offset)
                for offset in next_zero_offsets
            ]
            save_pressure_calibration(next_calibration)

            self._zero_offsets = next_zero_offsets
            self._raw_buffers[channel_index] = deque(
                ((timestamp_ms, value - tare_value) for timestamp_ms, value in self._raw_buffers[channel_index]),
                maxlen=RAW_BUFFER_MAXLEN,
            )
            self._transport_buffers[channel_index] = deque(
                (
                    (timestamp_ms, value - tare_value)
                    for timestamp_ms, value in self._transport_buffers[channel_index]
                ),
                maxlen=TRANSPORT_BUFFER_MAXLEN,
            )

            logger.info(
                "pressure tare applied: index=%s tare_value=%s zero_offset=%s",
                channel_index,
                tare_value,
                next_zero_offsets[channel_index],
            )
            return tare_value

    def _data_file_bucket(self, timestamp_ms: int) -> int:
        return timestamp_ms // HISTORY_FILE_BUCKET_MS

    def _data_file_path(self, index: int, bucket: int) -> Path:
        timestamp = datetime.fromtimestamp((bucket * HISTORY_FILE_BUCKET_MS) / 1000)
        return self._data_dir / f"pt-{index + 1}-{timestamp:%Y%m%d-%H}.csv"

    def _open_data_file(self, index: int, bucket: int) -> TextIO:
        path = self._data_file_path(index, bucket)
        is_new_file = not path.exists() or path.stat().st_size == 0
        handle = path.open("a", encoding="utf-8", buffering=1)

        if is_new_file:
            handle.write("timestamp_ms,psi,voltage\n")

        return handle

    def _get_data_file(self, index: int, timestamp_ms: int) -> TextIO:
        bucket = self._data_file_bucket(timestamp_ms)

        if self._file_handles[index] is not None and self._file_handle_buckets[index] == bucket:
            return self._file_handles[index]

        if self._file_handles[index] is not None:
            with contextlib.suppress(Exception):
                self._file_handles[index].flush()
                self._file_handles[index].close()

        handle = self._open_data_file(index, bucket)
        self._file_handles[index] = handle
        self._file_handle_buckets[index] = bucket
        return handle

    def _history_file_paths(
        self,
        index: int,
        start_time: int | None,
        end_time: int | None,
    ) -> list[Path]:
        if start_time is None or end_time is None:
            return sorted(self._data_dir.glob(f"pt-{index + 1}-*.csv"))

        start_bucket = self._data_file_bucket(start_time)
        end_bucket = self._data_file_bucket(end_time)
        return [
            path
            for bucket in range(start_bucket, end_bucket + 1)
            if (path := self._data_file_path(index, bucket)).exists()
        ]

    def _read_data_files(
        self,
        index: int,
        start_time: int | None,
        end_time: int | None,
    ) -> list[tuple[int, float]]:
        readings: list[tuple[int, float]] = []

        for path in self._history_file_paths(index, start_time, end_time):
            try:
                with path.open("r", encoding="utf-8", newline="") as handle:
                    for row in csv.DictReader(handle):
                        timestamp = row.get("timestamp_ms")
                        psi = row.get("psi")

                        if timestamp is None or psi is None:
                            continue

                        timestamp_ms = int(timestamp)
                        if not self._time_in_range(timestamp_ms, start_time, end_time):
                            continue

                        readings.append((timestamp_ms, float(psi)))
            except Exception as exc:
                logger.warning("failed to read pressure history file: path=%s error=%s", path, exc)

        return readings

    def _time_in_range(
        self,
        timestamp_ms: int,
        start_time: int | None,
        end_time: int | None,
    ) -> bool:
        if start_time is not None and timestamp_ms < start_time:
            return False

        return not (end_time is not None and timestamp_ms > end_time)

    def _filter_history(
        self,
        readings: list[tuple[int, float]],
        start_time: int | None,
        end_time: int | None,
    ) -> list[tuple[int, float]]:
        return [
            (timestamp_ms, psi)
            for timestamp_ms, psi in readings
            if self._time_in_range(timestamp_ms, start_time, end_time)
        ]

    def _merge_history(
        self,
        persisted: list[tuple[int, float]],
        buffered: list[tuple[int, float]],
    ) -> list[tuple[int, float]]:
        if not persisted:
            return buffered

        if not buffered:
            return persisted

        seen = {timestamp_ms for timestamp_ms, _psi in persisted}
        merged = persisted + [
            (timestamp_ms, psi)
            for timestamp_ms, psi in buffered
            if timestamp_ms not in seen
        ]
        return sorted(merged, key=lambda reading: reading[0])

    def _downsample_history(
        self,
        readings: list[tuple[int, float]],
        max_points: int,
    ) -> list[tuple[int, float]]:
        limit = max(2, max_points)

        if len(readings) <= limit:
            return readings

        return [
            readings[round(index * (len(readings) - 1) / (limit - 1))]
            for index in range(limit)
        ]

    def _run(self) -> None:
        channel_index = 0

        while not self._stop_event.is_set():
            current_channel_index = channel_index
            channel_index = (channel_index + 1) % PRESSURE_TRANSDUCER_COUNT

            try:
                voltage = self._read_voltage(current_channel_index)
                timestamp_ms = int(time.time() * 1000)
                self._record_sample(current_channel_index, timestamp_ms, voltage)
            except Exception as exc:
                self._record_read_failure(current_channel_index, exc)
                time.sleep(TRANSPORT_SAMPLE_INTERVAL_SECONDS)

    def _read_voltage(self, channel_index: int) -> float:
        for attempt in range(1, PRESSURE_READ_MAX_ATTEMPTS + 1):
            try:
                return float(self._channels[channel_index].voltage)
            except Exception:
                if attempt >= PRESSURE_READ_MAX_ATTEMPTS:
                    raise

                time.sleep(PRESSURE_READ_RETRY_DELAY_SECONDS)

        raise RuntimeError("pressure_read_unreachable")

    def _voltage_to_psi(self, voltage: float, zero_offset: float) -> float:
        psi = (voltage / PRESSURE_TRANSDUCER_MAX_VOLTAGE) * PRESSURE_TRANSDUCER_MAX_PSI
        psi -= zero_offset
        return min(PRESSURE_TRANSDUCER_MAX_PSI, psi)

    def _record_sample(
        self,
        channel_index: int,
        timestamp_ms: int,
        voltage: float,
    ) -> None:
        with self._lock:
            previous_failures = self._consecutive_failures[channel_index]
            self._consecutive_failures[channel_index] = 0
            psi = self._voltage_to_psi(voltage, self._zero_offsets[channel_index])
            self._sensor_ok[channel_index] = True
            self._raw_buffers[channel_index].append((timestamp_ms, psi))

            if (
                timestamp_ms - self._last_transport_sample_times[channel_index]
                >= TRANSPORT_SAMPLE_INTERVAL_SECONDS * 1000
            ):
                self._transport_buffers[channel_index].append((timestamp_ms, psi))
                self._last_transport_sample_times[channel_index] = float(timestamp_ms)

        if previous_failures > 0:
            logger.info(
                "pressure channel recovered: channel=%s missed_samples=%s",
                channel_index,
                previous_failures,
            )

        self._get_data_file(channel_index, timestamp_ms).write(
            f"{timestamp_ms},{psi:.6f},{voltage:.6f}\n"
        )

    def _record_read_failure(self, channel_index: int, exc: Exception) -> None:
        with self._lock:
            self._sensor_ok[channel_index] = False
            self._consecutive_failures[channel_index] += 1
            consecutive_failures = self._consecutive_failures[channel_index]

        error_summary = f"{type(exc).__name__}: {exc}"

        if consecutive_failures == 1:
            logger.warning(
                "failed to record pressure sample: channel=%s error=%s",
                channel_index,
                error_summary,
            )
            logger.debug(
                "pressure sample failure details: channel=%s",
                channel_index,
                exc_info=(type(exc), exc, exc.__traceback__),
            )
            return

        if consecutive_failures % PRESSURE_FAILURE_LOG_INTERVAL == 0:
            logger.warning(
                "pressure sample still failing: channel=%s consecutive_failures=%s error=%s",
                channel_index,
                consecutive_failures,
                error_summary,
            )
            return

        logger.debug(
            "pressure sample failed: channel=%s consecutive_failures=%s error=%s",
            channel_index,
            consecutive_failures,
            error_summary,
        )
