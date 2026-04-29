from __future__ import annotations

import asyncio
import contextlib
import importlib
import logging
import sys
from pathlib import Path
from typing import Any, Literal

from config import IGNITION_GPIO_PIN

logger = logging.getLogger(__name__)
RASPBERRY_PI_SYSTEM_PACKAGES = Path("/usr/lib/python3/dist-packages")

IgnitionStableState = Literal["ON", "OFF"]
IgnitionState = IgnitionStableState | Literal["UNKNOWN"]


class IgnitionController:
    def __init__(self, pin: int = IGNITION_GPIO_PIN) -> None:
        self._lock = asyncio.Lock()
        self._gpio: Any | None = None
        self._pin = pin
        self.available = False
        self.error: str | None = None
        self._state: IgnitionState = "UNKNOWN"

        try:
            self._add_raspberry_pi_system_packages()
            gpio = importlib.import_module("RPi.GPIO")
            gpio.setwarnings(False)
            gpio.setmode(gpio.BCM)
            gpio.setup(self._pin, gpio.OUT, initial=gpio.LOW)

            self._gpio = gpio
            self._state = "OFF"
            self.available = True
            logger.info("ignition hardware ready: pin=%s state=%s", self._pin, self._state)
        except Exception as exc:
            self.error = str(exc)
            logger.exception("ignition initialization failed")

    def close(self) -> None:
        if self._gpio is None:
            return

        with contextlib.suppress(Exception):
            self._set_state_sync("OFF", announce=False)
        with contextlib.suppress(Exception):
            self._gpio.cleanup(self._pin)

        self._gpio = None
        self.available = False
        self._state = "OFF"

    def state_payload(self) -> dict[str, IgnitionState]:
        return {"state": self._state}

    def _add_raspberry_pi_system_packages(self) -> None:
        package_path = str(RASPBERRY_PI_SYSTEM_PACKAGES)
        if RASPBERRY_PI_SYSTEM_PACKAGES.exists() and package_path not in sys.path:
            sys.path.append(package_path)

    def _ensure_available(self) -> None:
        if self.available:
            return

        suffix = f":{self.error}" if self.error else ""
        raise ValueError(f"ignition_unavailable{suffix}")

    def _set_state_sync(self, target_state: IgnitionStableState, *, announce: bool = True) -> None:
        if self._gpio is None:
            raise ValueError("ignition_unavailable")

        output = self._gpio.HIGH if target_state == "ON" else self._gpio.LOW
        self._gpio.output(self._pin, output)
        self._state = target_state
        if announce:
            logger.info("ignition state set: pin=%s state=%s", self._pin, target_state)

    async def set_state(self, target_state: IgnitionStableState) -> IgnitionState:
        async with self._lock:
            self._ensure_available()
            self._set_state_sync(target_state)
            return self._state
