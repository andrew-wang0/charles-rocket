from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from config import (
    LOAD_CELL_OFFSET,
    LOAD_CELL_REFERENCE_UNIT,
    PRESSURE_TRANSDUCER_COUNT,
    SERVO_CLOSED_ANGLE,
    SERVO_OPEN_ANGLE,
    SERVO_CHANNELS,
)

logger = logging.getLogger(__name__)
CALIBRATION_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class ServoCalibrationEntry:
    open: float
    close: float


@dataclass(frozen=True)
class PressureCalibrationEntry:
    zero: float


@dataclass(frozen=True)
class LoadCalibrationEntry:
    reference_unit: float
    zero: float


@dataclass(frozen=True)
class CalibrationSet:
    servo: list[ServoCalibrationEntry]
    pressure: list[PressureCalibrationEntry]
    load: LoadCalibrationEntry


def load_calibration_set() -> CalibrationSet:
    servo = _load_servo_calibration()
    pressure = _load_pressure_calibration()
    load = _load_load_calibration()

    logger.info(
        "loaded calibration: servo=%s pressure=%s load=%s",
        servo,
        pressure,
        load,
    )
    return CalibrationSet(servo=servo, pressure=pressure, load=load)


def _load_servo_calibration() -> list[ServoCalibrationEntry]:
    default = [
        ServoCalibrationEntry(open=SERVO_OPEN_ANGLE, close=SERVO_CLOSED_ANGLE)
        for _ in SERVO_CHANNELS
    ]
    payload = _read_json("servo_calibration.json")
    if not isinstance(payload, list):
        return default

    entries = [
        ServoCalibrationEntry(
            open=float(item.get("open", SERVO_OPEN_ANGLE)),
            close=float(item.get("close", SERVO_CLOSED_ANGLE)),
        )
        for item in payload[: len(SERVO_CHANNELS)]
        if isinstance(item, dict)
    ]
    return _pad(entries, default)


def _load_pressure_calibration() -> list[PressureCalibrationEntry]:
    default = [PressureCalibrationEntry(zero=0.0) for _ in range(PRESSURE_TRANSDUCER_COUNT)]
    payload = _read_json("pressure_transducer_calibration.json")
    if not isinstance(payload, list):
        return default

    entries = [
        PressureCalibrationEntry(zero=float(item.get("zero", item.get("offset", 0.0))))
        for item in payload[:PRESSURE_TRANSDUCER_COUNT]
        if isinstance(item, dict)
    ]
    return _pad(entries, default)


def save_pressure_calibration(entries: Sequence[PressureCalibrationEntry]) -> None:
    payload = [{"zero": float(entry.zero)} for entry in entries[:PRESSURE_TRANSDUCER_COUNT]]
    default_count = PRESSURE_TRANSDUCER_COUNT - len(payload)
    if default_count > 0:
        payload.extend({"zero": 0.0} for _ in range(default_count))

    _write_json("pressure_transducer_calibration.json", payload)


def save_load_calibration(entry: LoadCalibrationEntry) -> None:
    _write_json(
        "load_cell_calibration.json",
        {
            "reference_unit": float(entry.reference_unit),
            "zero": float(entry.zero),
        },
    )


def _load_load_calibration() -> LoadCalibrationEntry:
    payload = _read_json("load_cell_calibration.json")
    if not isinstance(payload, dict):
        return LoadCalibrationEntry(reference_unit=LOAD_CELL_REFERENCE_UNIT, zero=LOAD_CELL_OFFSET)

    return LoadCalibrationEntry(
        reference_unit=float(payload.get("reference_unit", LOAD_CELL_REFERENCE_UNIT)),
        zero=float(payload.get("zero", payload.get("offset", LOAD_CELL_OFFSET))),
    )


def _read_json(filename: str):
    path = CALIBRATION_DIR / filename

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("failed to read calibration file: %s", path)
        return None


def _write_json(filename: str, payload: object) -> None:
    path = CALIBRATION_DIR / filename
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _pad(entries, defaults):
    if len(entries) >= len(defaults):
        return entries[: len(defaults)]

    return [*entries, *defaults[len(entries) :]]
