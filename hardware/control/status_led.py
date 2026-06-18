from __future__ import annotations

import asyncio
import atexit
import contextlib
import importlib
import logging
import signal
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
        self._exit_handler_registered = False
        self.available = False
        self.error: str | None = None
        self._pin = pin
        self._pixel_count = pixel_count
        self._on = False
        self._closed = False
        self._active_blink: BlinkState | None = None
        self._state_changed = asyncio.Event()

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

    def _register_exit_handler(self) -> None:
        if self._exit_handler_registered:
            return

        atexit.register(self._reset_on_exit)
        self._exit_handler_registered = True

    def force_reset(self) -> None:
        with contextlib.suppress(Exception):
            self._reset()

    def _reset_on_exit(self) -> None:
        if self._pixels is None:
            return

        self.force_reset()

    def register_shutdown_signals(self, loop: asyncio.AbstractEventLoop) -> None:
        main_task = asyncio.current_task()
        if main_task is None:
            return

        def on_shutdown_signal() -> None:
            logger.info("status led shutdown signal received")
            self.force_reset()
            main_task.cancel()

        for sig in (signal.SIGTERM, signal.SIGINT):
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, on_shutdown_signal)

    def notify_state_changed(self) -> None:
        self._state_changed.set()

    def _reset(self) -> None:
        if self._pixels is None:
            return

        self._pixels.fill(OFF)
        self._pixels.show()

    def _set_color(self, color: tuple[int, int, int]) -> None:
        if self._pixels is None:
            return

        self._pixels[0] = color
        self._pixels.show()

    async def _wait_for_interval_or_state_change(
        self,
        interval_seconds: float,
        blink_state: BlinkState,
    ) -> bool:
        sleep_task = asyncio.create_task(asyncio.sleep(interval_seconds))
        event_task = asyncio.create_task(self._state_changed.wait())

        _done, pending = await asyncio.wait(
            {sleep_task, event_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        self._state_changed.clear()
        return self._state_provider() != blink_state

    async def _blink_loop(self) -> None:
        try:
            while True:
                blink_state = self._state_provider()
                color, interval_seconds = blink_state

                if blink_state != self._active_blink:
                    self._active_blink = blink_state
                    self._on = True
                    self._set_color(color)
                else:
                    self._on = not self._on
                    self._set_color(color if self._on else OFF)

                if await self._wait_for_interval_or_state_change(interval_seconds, blink_state):
                    continue
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                self._reset()
            raise
        except Exception:
            logger.exception("status led blink loop failed")

    def start(self) -> None:
        global _status_led

        if not self.available or self._task is not None:
            return

        _status_led = self
        self._register_exit_handler()
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
        global _status_led

        if self._closed:
            return

        self._closed = True
        if _status_led is self:
            _status_led = None
        with contextlib.suppress(Exception):
            self._reset()

        if self._pixels is not None:
            with contextlib.suppress(Exception):
                self._pixels.deinit()
            self._pixels = None

        self.available = False


_status_led: StatusLed | None = None


def notify_status_led_state_changed() -> None:
    if _status_led is not None:
        _status_led.notify_state_changed()


__all__ = ["StatusLed", "notify_status_led_state_changed"]
