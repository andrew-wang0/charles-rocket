from __future__ import annotations

import asyncio
import contextlib
import importlib
import logging
import sys
from pathlib import Path
from typing import Any, Literal, TypedDict

from .constants import (
    PCA9685_I2C_ADDRESS,
    PCA9685_PWM_FREQUENCY,
    SERVO_ACTUATION_RANGE,
    SERVO_CHANNELS,
    SERVO_CLOSED_ANGLE,
    SERVO_MAX_PULSE_US,
    SERVO_MIN_PULSE_US,
    SERVO_OPEN_ANGLE,
    SERVO_TRANSITION_SECONDS,
)

logger = logging.getLogger(__name__)
RASPBERRY_PI_SYSTEM_PACKAGES = Path("/usr/lib/python3/dist-packages")

ServoStableState = Literal["open", "closed"]
ServoTransitionState = Literal["opening", "closing"]
ServoUnknownState = Literal["unknown"]
ServoState = ServoStableState | ServoTransitionState | ServoUnknownState


class ServoChannelState(TypedDict):
    channel: int
    state: ServoState


class ServoController:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.available = False
        self.error: str | None = None
        self._pca: Any | None = None
        self._servos: dict[int, Any] = {}
        self._angles: dict[int, float | None] = {channel: None for channel in SERVO_CHANNELS}
        self._states: dict[int, ServoState] = {channel: "unknown" for channel in SERVO_CHANNELS}

        try:
            self._add_raspberry_pi_system_packages()
            board = importlib.import_module("board")
            busio = importlib.import_module("busio")
            servo_module = importlib.import_module("adafruit_motor.servo")
            pca9685_module = importlib.import_module("adafruit_pca9685")

            i2c = busio.I2C(board.SCL, board.SDA)
            self._pca = pca9685_module.PCA9685(i2c, address=PCA9685_I2C_ADDRESS)
            self._pca.frequency = PCA9685_PWM_FREQUENCY

            for channel in SERVO_CHANNELS:
                self._servos[channel] = servo_module.Servo(
                    self._pca.channels[channel],
                    min_pulse=SERVO_MIN_PULSE_US,
                    max_pulse=SERVO_MAX_PULSE_US,
                    actuation_range=SERVO_ACTUATION_RANGE,
                )

            self._set_startup_state()
            self.available = True
            logger.info(
                "servo hardware ready: address=0x%02x frequency=%sHz closed=%s open=%s",
                PCA9685_I2C_ADDRESS,
                PCA9685_PWM_FREQUENCY,
                SERVO_CLOSED_ANGLE,
                SERVO_OPEN_ANGLE,
            )
        except Exception as exc:
            self.error = str(exc)
            logger.exception("servo initialization failed")

    def close(self) -> None:
        if self._pca is None:
            return

        with contextlib.suppress(Exception):
            self._pca.deinit()
        self._pca = None

    def state_payload(self) -> dict[str, list[ServoChannelState]]:
        return {
            "channels": [
                {
                    "channel": channel,
                    "state": self._states[channel],
                }
                for channel in SERVO_CHANNELS
            ],
        }

    def _validate_channel(self, channel: int) -> None:
        if channel not in SERVO_CHANNELS:
            raise ValueError("invalid_channel")

    def _add_raspberry_pi_system_packages(self) -> None:
        package_path = str(RASPBERRY_PI_SYSTEM_PACKAGES)
        if RASPBERRY_PI_SYSTEM_PACKAGES.exists() and package_path not in sys.path:
            sys.path.append(package_path)

    def _ensure_available(self) -> None:
        if self.available:
            return

        suffix = f":{self.error}" if self.error else ""
        raise ValueError(f"servo_unavailable{suffix}")

    def _target_state_for_toggle(self, channel: int) -> ServoStableState:
        return "closed" if self._states[channel] == "open" else "open"

    def _target_angle(self, target_state: ServoStableState) -> float:
        return SERVO_OPEN_ANGLE if target_state == "open" else SERVO_CLOSED_ANGLE

    def _set_angle_sync(self, channel: int, target_state: ServoStableState) -> None:
        angle = self._target_angle(target_state)
        self._servos[channel].angle = angle
        self._angles[channel] = angle
        logger.info("servo angle set: channel=%s target=%s angle=%s", channel, target_state, angle)

    def _set_startup_state(self) -> None:
        for channel in SERVO_CHANNELS:
            self._set_angle_sync(channel, "closed")
            self._states[channel] = "closed"

    async def toggle_servo(self, channel: int) -> tuple[list[int], ServoStableState]:
        async with self._lock:
            self._validate_channel(channel)
            self._ensure_available()
            target_state = self._target_state_for_toggle(channel)
            channels = await self._start_transitions([channel], target_state)
            return channels, target_state

    async def set_servo(self, channel: int, target_state: ServoStableState) -> list[int]:
        async with self._lock:
            self._validate_channel(channel)
            self._ensure_available()
            return await self._start_transitions([channel], target_state)

    async def set_all_servos(self, target_state: ServoStableState) -> list[int]:
        async with self._lock:
            self._ensure_available()
            return await self._start_transitions(list(SERVO_CHANNELS), target_state)

    async def _start_transitions(self, channels: list[int], target_state: ServoStableState) -> list[int]:
        for channel in channels:
            current_state = self._states[channel]
            if current_state in ("opening", "closing"):
                raise ValueError("servo_busy")

        transition_state: ServoTransitionState = "opening" if target_state == "open" else "closing"
        started_channels: list[int] = []

        for channel in channels:
            if self._states[channel] == target_state:
                continue

            try:
                await asyncio.to_thread(self._set_angle_sync, channel, target_state)
            except Exception as exc:
                logger.exception("failed to move servo channel=%s target=%s", channel, target_state)
                raise ValueError("servo_hardware_error") from exc

            self._states[channel] = transition_state
            started_channels.append(channel)

        return started_channels

    async def finish_transitions(
        self,
        channels: list[int],
        target_state: ServoStableState,
    ) -> None:
        if not channels:
            return

        await asyncio.sleep(SERVO_TRANSITION_SECONDS)

        async with self._lock:
            for channel in channels:
                self._states[channel] = target_state
