from __future__ import annotations

import contextlib
import importlib
import json
import logging
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, TextIO

from .constants import (
    LOAD_CELL_CLOCK_PIN,
    LOAD_CELL_DATA_PIN,
    LOAD_CELL_OFFSET,
    LOAD_CELL_REFERENCE_UNIT,
    LOAD_CELL_SAMPLES_PER_READING,
    LOAD_CELL_WINDOW_SECONDS,
)

logger = logging.getLogger(__name__)
RASPBERRY_PI_SYSTEM_PACKAGES = Path("/usr/lib/python3/dist-packages")


class LoadSampler:
    def __init__(self) -> None:
        self.available = False
        self.error: str | None = None

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._hx: Any | None = None
        self._sensor_ok = False
        self._buffer: deque[tuple[int, float]] = deque()
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "load-cell"
        self._data_file: TextIO | None = None
        self._calibration_path = (
            Path(__file__).resolve().parent / "calibration" / "load_cell_calibration.json"
        )
        self._reference_unit, self._offset = self._load_calibration()

        try:
            self._add_raspberry_pi_system_packages()

            hx711_module = importlib.import_module("HX711")

            self._hx = hx711_module.SimpleHX711(
                LOAD_CELL_DATA_PIN,
                LOAD_CELL_CLOCK_PIN,
                self._reference_unit,
                self._offset,
            )
            self._hx.setUnit(hx711_module.Mass.Unit.LB)

            self.available = True
            logger.info(
                "load sampler ready: data_pin=%s clock_pin=%s reference_unit=%s offset=%s",
                LOAD_CELL_DATA_PIN,
                LOAD_CELL_CLOCK_PIN,
                self._reference_unit,
                self._offset,
            )
        except Exception as exc:
            self.error = str(exc)
            logger.exception("load sampler initialization failed")

    def _add_raspberry_pi_system_packages(self) -> None:
        package_path = str(RASPBERRY_PI_SYSTEM_PACKAGES)
        if RASPBERRY_PI_SYSTEM_PACKAGES.exists() and package_path not in sys.path:
            sys.path.append(package_path)

    def _load_calibration(self) -> tuple[float, float]:
        if not self._calibration_path.exists():
            return LOAD_CELL_REFERENCE_UNIT, LOAD_CELL_OFFSET

        try:
            payload = json.loads(self._calibration_path.read_text(encoding="utf-8"))
            return (
                float(payload.get("reference_unit", LOAD_CELL_REFERENCE_UNIT)),
                float(payload.get("offset", LOAD_CELL_OFFSET)),
            )
        except Exception:
            logger.exception("failed to load load cell calibration, using defaults")
            return LOAD_CELL_REFERENCE_UNIT, LOAD_CELL_OFFSET

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

        if self._hx is not None and hasattr(self._hx, "powerDown"):
            with contextlib.suppress(Exception):
                self._hx.powerDown()

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
                pounds = max(0.0, float(self._hx.weight(LOAD_CELL_SAMPLES_PER_READING)))
                self._record_sample(timestamp_ms, pounds)
            except Exception:
                logger.exception("failed to record load sample")
                with self._lock:
                    self._sensor_ok = False
                time.sleep(0.05)

    def _record_sample(self, timestamp_ms: int, pounds: float) -> None:
        cutoff = timestamp_ms - LOAD_CELL_WINDOW_SECONDS * 1000

        with self._lock:
            self._sensor_ok = True
            self._buffer.append((timestamp_ms, pounds))

            while (self._buffer[0][0] if self._buffer else timestamp_ms) < cutoff:
                self._buffer.popleft()

        if self._data_file is not None:
            self._data_file.write(f"{timestamp_ms},{pounds:.6f}\n")
