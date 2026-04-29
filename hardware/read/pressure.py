from __future__ import annotations

import contextlib
import importlib
import logging
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Sequence, TextIO

from calibration import PressureCalibrationEntry
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
        self._file_handles: list[TextIO] = []

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
        self._file_handles = [self._open_data_file(index) for index in range(PRESSURE_TRANSDUCER_COUNT)]

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="pressure-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=THREAD_JOIN_TIMEOUT_SECONDS)
            self._thread = None

        for handle in self._file_handles:
            with contextlib.suppress(Exception):
                handle.flush()
                handle.close()

        self._file_handles = []

        if self._i2c is not None:
            with contextlib.suppress(Exception):
                self._i2c.deinit()
            self._i2c = None

    def status_payload(self) -> list[bool]:
        with self._lock:
            return list(self._sensor_ok)

    def history_payload(self) -> list[list[dict[str, float | int]]]:
        with self._lock:
            return [
                [{"time": timestamp_ms, "value": psi} for timestamp_ms, psi in buffer]
                for buffer in self._transport_buffers
            ]

    def latest_payload(self) -> list[list[dict[str, float | int]]]:
        with self._lock:
            return [
                []
                if not buffer
                else [{"time": buffer[-1][0], "value": buffer[-1][1]}]
                for buffer in self._raw_buffers
            ]

    def _open_data_file(self, index: int) -> TextIO:
        path = self._data_dir / f"pt-{index + 1}.csv"
        is_new_file = not path.exists() or path.stat().st_size == 0
        handle = path.open("a", encoding="utf-8", buffering=1)

        if is_new_file:
            handle.write("timestamp_ms,psi,voltage\n")

        return handle

    def _run(self) -> None:
        channel_index = 0

        while not self._stop_event.is_set():
            try:
                voltage = self._read_voltage(channel_index)
                timestamp_ms = int(time.time() * 1000)
                psi = self._voltage_to_psi(voltage, channel_index)
                self._record_sample(channel_index, timestamp_ms, psi, voltage)
                channel_index = (channel_index + 1) % PRESSURE_TRANSDUCER_COUNT
            except Exception:
                logger.exception("failed to record pressure sample on channel=%s", channel_index)
                with self._lock:
                    self._sensor_ok[channel_index] = False
                time.sleep(TRANSPORT_SAMPLE_INTERVAL_SECONDS)

    def _read_voltage(self, channel_index: int) -> float:
        return float(self._channels[channel_index].voltage)

    def _voltage_to_psi(self, voltage: float, channel_index: int) -> float:
        psi = (voltage / PRESSURE_TRANSDUCER_MAX_VOLTAGE) * PRESSURE_TRANSDUCER_MAX_PSI
        psi -= self._zero_offsets[channel_index]
        return max(0.0, min(PRESSURE_TRANSDUCER_MAX_PSI, psi))

    def _record_sample(
        self,
        channel_index: int,
        timestamp_ms: int,
        psi: float,
        voltage: float,
    ) -> None:
        with self._lock:
            self._sensor_ok[channel_index] = True
            self._raw_buffers[channel_index].append((timestamp_ms, psi))

            if (
                timestamp_ms - self._last_transport_sample_times[channel_index]
                >= TRANSPORT_SAMPLE_INTERVAL_SECONDS * 1000
            ):
                self._transport_buffers[channel_index].append((timestamp_ms, psi))
                self._last_transport_sample_times[channel_index] = float(timestamp_ms)

        self._file_handles[channel_index].write(f"{timestamp_ms},{psi:.6f},{voltage:.6f}\n")
