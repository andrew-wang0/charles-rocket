from __future__ import annotations

import contextlib
import csv
import importlib
import logging
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, TextIO

from calibration import LoadCalibrationEntry, save_load_calibration
from config import (
    LOAD_CELL_CLOCK_PIN,
    LOAD_CELL_DATA_PIN,
    LOAD_CELL_OFFSET,
    LOAD_CELL_REFERENCE_UNIT,
    LOAD_CELL_SAMPLES_PER_READING,
    LOAD_CELL_WINDOW_SECONDS,
)

logger = logging.getLogger(__name__)
MAX_CONSECUTIVE_READ_FAILURES = 5
CONSECUTIVE_READ_FAILURE_WARNING_THRESHOLD = 3
THREAD_JOIN_TIMEOUT_SECONDS = 0.2
HX711_CLOCK_HIGH_TIMEOUT_SECONDS = 0.00006
HX711_READ_MAX_TRIES = 12
HX711_READ_ATTEMPT_MULTIPLIER = 4
HISTORY_FILE_BUCKET_MS = 60 * 60 * 1000
DEFAULT_HISTORY_MAX_POINTS = 1_200


class LoadSampler:
    def __init__(self, calibration: LoadCalibrationEntry | None = None) -> None:
        self.available = False
        self.error: str | None = None

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._hx: Any | None = None
        self._gpio: Any | None = None
        self._sensor_ok = False
        self._consecutive_failures = 0
        self._buffer: deque[tuple[int, float]] = deque()
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "load-cell"
        self._data_file: TextIO | None = None
        self._data_file_bucket: int | None = None
        self._reference_unit = calibration.reference_unit if calibration else LOAD_CELL_REFERENCE_UNIT
        self._zero = calibration.zero if calibration else LOAD_CELL_OFFSET

        try:
            hx711_module = importlib.import_module("hx711")
            self._gpio = importlib.import_module("RPi.GPIO")
            self._hx = self._create_safe_hx711(hx711_module)(
                dout_pin=LOAD_CELL_DATA_PIN,
                pd_sck_pin=LOAD_CELL_CLOCK_PIN,
                channel="A",
                gain=128,
            )
            self._hx.min_measures = 1
            self._hx.reset()

            self.available = True
            logger.info(
                "load sampler ready: data_pin=%s clock_pin=%s reference_unit=%s zero=%s",
                LOAD_CELL_DATA_PIN,
                LOAD_CELL_CLOCK_PIN,
                self._reference_unit,
                self._zero,
            )
        except Exception as exc:
            self.error = self._format_init_error(exc)

    def _create_safe_hx711(self, hx711_module: Any) -> type[Any]:
        gpio = hx711_module.GPIO
        generic_error = getattr(hx711_module, "GenericHX711Exception", RuntimeError)

        class SafeHX711(hx711_module.HX711):
            def _set_channel_gain(self, num: int) -> bool:
                if not 1 <= num <= 3:
                    raise AttributeError('"num" has to be in the range of 1 to 3')

                for _ in range(num):
                    start_counter = time.perf_counter()
                    gpio.output(self._pd_sck, True)
                    gpio.output(self._pd_sck, False)
                    time_elapsed = time.perf_counter() - start_counter

                    if time_elapsed >= HX711_CLOCK_HIGH_TIMEOUT_SECONDS:
                        raise generic_error(
                            "hx711_gain_set_timeout:{:0.8f}".format(time_elapsed)
                        )

                return True

            def get_raw_data(self, times: int = 5) -> list[int]:
                self._validate_measure_count(times)

                data_list: list[int] = []
                max_attempts = max(times * HX711_READ_ATTEMPT_MULTIPLIER, times)
                attempts = 0

                while len(data_list) < times and attempts < max_attempts:
                    attempts += 1
                    data = self._read(max_tries=HX711_READ_MAX_TRIES)
                    if data not in [False, -1]:
                        data_list.append(data)

                if len(data_list) < times:
                    raise generic_error(
                        f"hx711_read_timeout:received={len(data_list)} expected={times} "
                        f"attempts={attempts}"
                    )

                return data_list

        return SafeHX711

    def _format_init_error(self, exc: Exception) -> str:
        if isinstance(exc, RecursionError):
            return (
                "HX711 initialization failed: reset hit Python recursion depth, "
                "usually due to unstable timing while setting gain/channel"
            )

        message = self._format_hx711_error(exc)
        if message is not None:
            return f"HX711 initialization failed: {message}"

        if isinstance(exc, (ImportError, ModuleNotFoundError, OSError)):
            return (
                f"{exc}. Install `hx711` and ensure `rpi-lgpio` is installed "
                "in the hardware virtualenv."
            )

        return str(exc)

    def _format_hx711_error(self, exc: Exception) -> str | None:
        message = str(exc)
        if message.startswith("hx711_gain_set_timeout:"):
            elapsed = message.partition(":")[2] or "unknown"
            return f"setting gain/channel exceeded 60us (elapsed={elapsed}s)"

        if message.startswith("hx711_read_timeout:"):
            return "timed out waiting for valid samples"

        return None

    def start(self) -> None:
        if not self.available:
            return

        if self._thread is not None and self._thread.is_alive():
            return

        self._data_dir.mkdir(parents=True, exist_ok=True)

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="load-sampler", daemon=True)
        self._thread.start()
        logger.info("load sampler started: data_dir=%s", self._data_dir)

    def stop(self) -> None:
        logger.info("load sampler stop requested")
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=THREAD_JOIN_TIMEOUT_SECONDS)
            self._thread = None

        if self._data_file is not None:
            with contextlib.suppress(Exception):
                self._data_file.flush()
                self._data_file.close()
            self._data_file = None
            self._data_file_bucket = None

        if self._hx is not None and hasattr(self._hx, "power_down"):
            with contextlib.suppress(Exception):
                self._hx.power_down()
            self._hx = None

        if self._gpio is not None:
            with contextlib.suppress(Exception):
                self._gpio.cleanup((LOAD_CELL_DATA_PIN, LOAD_CELL_CLOCK_PIN))
            self._gpio = None
        logger.info("load sampler stopped")

    def status_payload(self) -> bool:
        with self._lock:
            return self._sensor_ok

    def history_payload(
        self,
        start_time: int | None = None,
        end_time: int | None = None,
        max_points: int | None = None,
    ) -> list[dict[str, float | int]]:
        should_query_files = start_time is not None or end_time is not None
        limit = max_points or DEFAULT_HISTORY_MAX_POINTS
        history = self._read_data_files(start_time, end_time) if should_query_files else []

        with self._lock:
            buffer_history = self._filter_history(list(self._buffer), start_time, end_time)
            history = (
                self._merge_history(history, buffer_history)
                if should_query_files
                else buffer_history
            )

        return [
            {"time": timestamp_ms, "value": pounds}
            for timestamp_ms, pounds in self._downsample_history(history, limit)
        ]

    def latest_payload(self) -> list[dict[str, float | int]]:
        with self._lock:
            if not self._buffer:
                return []

            timestamp_ms, pounds = self._buffer[-1]
            return [{"time": timestamp_ms, "value": pounds}]

    def tare(self) -> float:
        with self._lock:
            latest = self._buffer[-1] if self._buffer else None
            if latest is None:
                raise ValueError("load_tare_unavailable")

            if self._reference_unit == 0:
                raise ValueError("load_tare_invalid_reference_unit")

            tare_value = latest[1]
            next_zero = self._zero + tare_value * self._reference_unit
            save_load_calibration(
                LoadCalibrationEntry(reference_unit=self._reference_unit, zero=next_zero)
            )

            self._zero = next_zero
            self._buffer = deque(
                ((timestamp_ms, value - tare_value) for timestamp_ms, value in self._buffer)
            )

            logger.info(
                "load tare applied: tare_value=%s zero=%s reference_unit=%s",
                tare_value,
                next_zero,
                self._reference_unit,
            )
            return tare_value

    def _data_file_bucket_value(self, timestamp_ms: int) -> int:
        return timestamp_ms // HISTORY_FILE_BUCKET_MS

    def _data_file_path(self, bucket: int) -> Path:
        timestamp = datetime.fromtimestamp((bucket * HISTORY_FILE_BUCKET_MS) / 1000)
        return self._data_dir / f"load-cell-{timestamp:%Y%m%d-%H}.csv"

    def _open_data_file(self, bucket: int) -> TextIO:
        path = self._data_file_path(bucket)
        is_new_file = not path.exists() or path.stat().st_size == 0
        handle = path.open("a", encoding="utf-8", buffering=1)

        if is_new_file:
            handle.write("timestamp_ms,pounds\n")

        return handle

    def _get_data_file(self, timestamp_ms: int) -> TextIO:
        bucket = self._data_file_bucket_value(timestamp_ms)

        if self._data_file is not None and self._data_file_bucket == bucket:
            return self._data_file

        if self._data_file is not None:
            with contextlib.suppress(Exception):
                self._data_file.flush()
                self._data_file.close()

        self._data_file = self._open_data_file(bucket)
        self._data_file_bucket = bucket
        return self._data_file

    def _history_file_paths(
        self,
        start_time: int | None,
        end_time: int | None,
    ) -> list[Path]:
        if start_time is None or end_time is None:
            return sorted(self._data_dir.glob("load-cell-*.csv"))

        start_bucket = self._data_file_bucket_value(start_time)
        end_bucket = self._data_file_bucket_value(end_time)
        return [
            path
            for bucket in range(start_bucket, end_bucket + 1)
            if (path := self._data_file_path(bucket)).exists()
        ]

    def _read_data_files(
        self,
        start_time: int | None,
        end_time: int | None,
    ) -> list[tuple[int, float]]:

        readings: list[tuple[int, float]] = []

        for path in self._history_file_paths(start_time, end_time):
            try:
                with path.open("r", encoding="utf-8", newline="") as handle:
                    for row in csv.DictReader(handle):
                        timestamp = row.get("timestamp_ms")
                        pounds = row.get("pounds")

                        if timestamp is None or pounds is None:
                            continue

                        timestamp_ms = int(timestamp)
                        if not self._time_in_range(timestamp_ms, start_time, end_time):
                            continue

                        readings.append((timestamp_ms, float(pounds)))
            except Exception as exc:
                logger.warning("failed to read load history file: path=%s error=%s", path, exc)

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
            (timestamp_ms, pounds)
            for timestamp_ms, pounds in readings
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

        seen = {timestamp_ms for timestamp_ms, _pounds in persisted}
        merged = persisted + [
            (timestamp_ms, pounds)
            for timestamp_ms, pounds in buffered
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
        while not self._stop_event.is_set():
            try:
                timestamp_ms = int(time.time() * 1000)
                pounds = self._read_weight()
                self._consecutive_failures = 0
                self._record_sample(timestamp_ms, pounds)
            except Exception as exc:
                self._consecutive_failures += 1
                read_failures_are_degraded = (
                    self._consecutive_failures >= CONSECUTIVE_READ_FAILURE_WARNING_THRESHOLD
                )
                if read_failures_are_degraded:
                    with self._lock:
                        self._sensor_ok = False

                formatted_error = self._format_hx711_error(exc)
                if self._consecutive_failures >= MAX_CONSECUTIVE_READ_FAILURES:
                    self.available = False
                    if formatted_error is not None:
                        logger.error(
                            "disabling load sampler after %s consecutive read failures: %s",
                            self._consecutive_failures,
                            formatted_error,
                        )
                    else:
                        logger.exception(
                            "disabling load sampler after %s consecutive read failures",
                            self._consecutive_failures,
                        )
                    return

                log_method = logger.warning if read_failures_are_degraded else logger.debug
                if formatted_error is not None:
                    log_method(
                        "failed to record load sample (%s/%s): %s",
                        self._consecutive_failures,
                        MAX_CONSECUTIVE_READ_FAILURES,
                        formatted_error,
                    )
                else:
                    if read_failures_are_degraded:
                        logger.exception(
                            "failed to record load sample (%s/%s): %s",
                            self._consecutive_failures,
                            MAX_CONSECUTIVE_READ_FAILURES,
                            type(exc).__name__,
                        )
                    else:
                        logger.debug(
                            "failed to record load sample (%s/%s): %s",
                            self._consecutive_failures,
                            MAX_CONSECUTIVE_READ_FAILURES,
                            type(exc).__name__,
                            exc_info=True,
                        )
                time.sleep(0.05)

    def _read_weight(self) -> float:
        raw_samples = self._hx.get_raw_data(times=LOAD_CELL_SAMPLES_PER_READING)

        if not raw_samples:
            raise RuntimeError("no load cell samples returned")

        raw_value = sum(raw_samples) / len(raw_samples)
        with self._lock:
            zero = self._zero
            reference_unit = self._reference_unit

        if reference_unit == 0:
            raise RuntimeError("load_reference_unit_zero")

        return (raw_value - zero) / reference_unit

    def _record_sample(self, timestamp_ms: int, pounds: float) -> None:
        cutoff = timestamp_ms - LOAD_CELL_WINDOW_SECONDS * 1000

        with self._lock:
            self._sensor_ok = True
            self._buffer.append((timestamp_ms, pounds))

            while (self._buffer[0][0] if self._buffer else timestamp_ms) < cutoff:
                self._buffer.popleft()

        self._get_data_file(timestamp_ms).write(f"{timestamp_ms},{pounds:.6f}\n")
