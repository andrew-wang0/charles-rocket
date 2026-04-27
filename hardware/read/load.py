from __future__ import annotations

import contextlib
import importlib
import logging
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, TextIO

from calibration import LoadCalibrationEntry
from config import (
    LOAD_CELL_CLOCK_PIN,
    LOAD_CELL_DATA_PIN,
    LOAD_CELL_OFFSET,
    LOAD_CELL_REFERENCE_UNIT,
    LOAD_CELL_SAMPLES_PER_READING,
    LOAD_CELL_WINDOW_SECONDS,
)

logger = logging.getLogger(__name__)


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
        self._buffer: deque[tuple[int, float]] = deque()
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "load-cell"
        self._data_file: TextIO | None = None
        self._reference_unit = calibration.reference_unit if calibration else LOAD_CELL_REFERENCE_UNIT
        self._zero = calibration.zero if calibration else LOAD_CELL_OFFSET

        try:
            hx711_module = importlib.import_module("hx711")
            self._gpio = importlib.import_module("RPi.GPIO")
            self._hx = hx711_module.HX711(
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
            logger.exception("load sampler initialization failed")

    def _format_init_error(self, exc: Exception) -> str:
        if isinstance(exc, (ImportError, ModuleNotFoundError, OSError)):
            return (
                f"{exc}. Install `hx711` and ensure `rpi-lgpio` is installed "
                "in the hardware virtualenv."
            )

        return str(exc)

    def start(self) -> None:
        if not self.available:
            return

        if self._thread is not None and self._thread.is_alive():
            return

        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._data_file = self._open_data_file()

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="load-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

        if self._data_file is not None:
            with contextlib.suppress(Exception):
                self._data_file.flush()
                self._data_file.close()
            self._data_file = None

        if self._hx is not None and hasattr(self._hx, "power_down"):
            with contextlib.suppress(Exception):
                self._hx.power_down()
            self._hx = None

        if self._gpio is not None:
            with contextlib.suppress(Exception):
                self._gpio.cleanup((LOAD_CELL_DATA_PIN, LOAD_CELL_CLOCK_PIN))
            self._gpio = None

    def status_payload(self) -> bool:
        with self._lock:
            return self._sensor_ok

    def history_payload(self) -> list[dict[str, float | int]]:
        with self._lock:
            return [
                {"time": timestamp_ms, "value": pounds}
                for timestamp_ms, pounds in self._buffer
            ]

    def latest_payload(self) -> list[dict[str, float | int]]:
        with self._lock:
            if not self._buffer:
                return []

            timestamp_ms, pounds = self._buffer[-1]
            return [{"time": timestamp_ms, "value": pounds}]

    def _open_data_file(self) -> TextIO:
        path = self._data_dir / "load-cell.csv"
        is_new_file = not path.exists() or path.stat().st_size == 0
        handle = path.open("a", encoding="utf-8", buffering=1)

        if is_new_file:
            handle.write("timestamp_ms,pounds\n")

        return handle

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                timestamp_ms = int(time.time() * 1000)
                pounds = max(0.0, self._read_weight())
                self._record_sample(timestamp_ms, pounds)
            except Exception:
                logger.exception("failed to record load sample")
                with self._lock:
                    self._sensor_ok = False
                time.sleep(0.05)

    def _read_weight(self) -> float:
        raw_samples = self._hx.get_raw_data(times=LOAD_CELL_SAMPLES_PER_READING)

        if not raw_samples:
            raise RuntimeError("no load cell samples returned")

        raw_value = sum(raw_samples) / len(raw_samples)
        return (raw_value - self._zero) / self._reference_unit

    def _record_sample(self, timestamp_ms: int, pounds: float) -> None:
        cutoff = timestamp_ms - LOAD_CELL_WINDOW_SECONDS * 1000

        with self._lock:
            self._sensor_ok = True
            self._buffer.append((timestamp_ms, pounds))

            while (self._buffer[0][0] if self._buffer else timestamp_ms) < cutoff:
                self._buffer.popleft()

        if self._data_file is not None:
            self._data_file.write(f"{timestamp_ms},{pounds:.6f}\n")
