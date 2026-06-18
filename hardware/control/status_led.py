from __future__ import annotations

import asyncio
import contextlib
import importlib
import logging
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from config import (
    STATUS_LED_ALERT_BLINK_INTERVAL_SECONDS,
    STATUS_LED_DATA_PIN,
    STATUS_LED_IDLE_BLINK_INTERVAL_SECONDS,
    STATUS_LED_IDLE_COLOR,
    STATUS_LED_PIXEL_COUNT,
)

logger = logging.getLogger(__name__)
RASPBERRY_PI_SYSTEM_PACKAGES = Path("/usr/lib/python3/dist-packages")

OFF = (0, 0, 0)

BlinkState = tuple[tuple[int, int, int], float]
StateProvider = Callable[[], BlinkState]


def default_blink_state() -> BlinkState:
    return STATUS_LED_IDLE_COLOR, STATUS_LED_IDLE_BLINK_INTERVAL_SECONDS


class StatusLed:
    def __init__(
        self,
        pin: int = STATUS_LED_DATA_PIN,
        pixel_count: int = STATUS_LED_PIXEL_COUNT,
        state_provider: StateProvider | None = None,
    ) -> None:
        self._pixels: Any | None = None
        self._task: asyncio.Task[None] | None = None
        self._state_provider = state_provider or default_blink_state
        self.available = False
        self.error: str | None = None
        self._pin = pin
        self._pixel_count = pixel_count
        self._on = False

        try:
            self._add_raspberry_pi_system_packages()
            board = importlib.import_module("board")
            neopixel = importlib.import_module("neopixel")

            pin_attr = f"D{self._pin}"
            if not hasattr(board, pin_attr):
                raise ValueError(f"unsupported_status_led_pin: {self._pin}")

            data_pin = getattr(board, pin_attr)
            self._pixels = neopixel.NeoPixel(data_pin, self._pixel_count, auto_write=False)
            self.available = True
            logger.info(
                "status led ready: pin=%s pixel_count=%s",
                self._pin,
                self._pixel_count,
            )
        except Exception as exc:
            self.error = str(exc)
            logger.exception("status led initialization failed")

    def _add_raspberry_pi_system_packages(self) -> None:
        package_path = str(RASPBERRY_PI_SYSTEM_PACKAGES)
        if RASPBERRY_PI_SYSTEM_PACKAGES.exists() and package_path not in sys.path:
            sys.path.append(package_path)

    def _set_color(self, color: tuple[int, int, int]) -> None:
        if self._pixels is None:
            return

        self._pixels[0] = color
        self._pixels.show()

    async def _blink_loop(self) -> None:
        try:
            while True:
                color, interval_seconds = self._state_provider()
                self._on = not self._on
                self._set_color(color if self._on else OFF)
                await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("status led blink loop failed")

    def start(self) -> None:
        if not self.available or self._task is not None:
            return

        self._task = asyncio.create_task(self._blink_loop())
        logger.info("status led blink started")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        self.close()

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._set_color(OFF)

        if self._pixels is not None:
            with contextlib.suppress(Exception):
                self._pixels.deinit()
            self._pixels = None

        self.available = False
