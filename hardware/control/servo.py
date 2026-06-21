from __future__ import annotations

import asyncio
import contextlib
import importlib
import logging
import sys
from pathlib import Path
from typing import Any, Literal, Sequence, TypedDict

from calibration import ServoCalibrationEntry
from config import (
    PCA9685_I2C_ADDRESS,
    PCA9685_PWM_FREQUENCY,
    SERVO_ACTUATION_RANGE,
    SERVO_CHANNELS,
    SERVO_CLOSED_ANGLE,
    SERVO_MAX_PULSE_US,
    SERVO_MIN_PULSE_US,
    SERVO_OPEN_ANGLE,
    SERVO_SLOW_CLOSE_CHANNELS,
    SERVO_SLOW_CLOSE_SECONDS,
    SERVO_SLOW_CLOSE_STEP_SECONDS,
    SERVO_MEDIUM_SLOW_OPEN_CHANNELS,
    SERVO_MEDIUM_SLOW_OPEN_SECONDS,
    SERVO_MEDIUM_SLOW_OPEN_STEP_SECONDS,
    SERVO_SLOW_OPEN_CHANNELS,
    SERVO_SLOW_OPEN_SECONDS,
    SERVO_SLOW_OPEN_STEP_SECONDS,
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
    def __init__(self, calibration: Sequence[ServoCalibrationEntry] | None = None) -> None:
        self._lock = asyncio.Lock()
        self.available = False
        self.error: str | None = None
        self._pca: Any | None = None
        self._servos: dict[int, Any] = {}
        self._angles: dict[int, float | None] = {channel: None for channel in SERVO_CHANNELS}
        self._states: dict[int, ServoState] = {channel: "unknown" for channel in SERVO_CHANNELS}
        self._open_angles = {
            channel: self._calibrated_angle(calibration, index, "open", SERVO_OPEN_ANGLE)
            for index, channel in enumerate(SERVO_CHANNELS)
        }
        self._close_angles = {
            channel: self._calibrated_angle(calibration, index, "close", SERVO_CLOSED_ANGLE)
            for index, channel in enumerate(SERVO_CHANNELS)
        }

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
                self._close_angles,
                self._open_angles,
            )
        except Exception as exc:
            self.error = str(exc)
            logger.exception("servo initialization failed")

    def close(self) -> None:
        if self._pca is None:
            return

        logger.info("servo controller shutdown started: states=%s", self._states)
        with contextlib.suppress(Exception):
            self._pca.deinit()
        self._pca = None
        self.available = False
        logger.info("servo controller shutdown finished")

    def _calibrated_angle(
        self,
        calibration: Sequence[ServoCalibrationEntry] | None,
        index: int,
        field: ServoStableState,
        fallback: float,
    ) -> float:
        if calibration is None or index >= len(calibration):
            return fallback

        entry = calibration[index]
        return entry.open if field == "open" else entry.close

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

    def _target_angle(self, channel: int, target_state: ServoStableState) -> float:
        return self._open_angles[channel] if target_state == "open" else self._close_angles[channel]

    def _set_angle_sync(self, channel: int, target_state: ServoStableState) -> None:
        angle = self._target_angle(channel, target_state)
        self._servos[channel].angle = angle
        self._angles[channel] = angle
        logger.info("servo angle set: channel=%s target=%s angle=%s", channel, target_state, angle)

    def _set_manual_angle_sync(self, channel: int, angle: float) -> None:
        self._servos[channel].angle = angle
        self._angles[channel] = angle
        logger.info("servo angle set: channel=%s target=manual angle=%s", channel, angle)

    def _set_startup_state(self) -> None:
        for channel in SERVO_CHANNELS:
            self._set_angle_sync(channel, "closed")
            self._states[channel] = "closed"

    def _uses_slow_open(self, channel: int, target_state: ServoStableState) -> bool:
        return (
            channel in SERVO_SLOW_OPEN_CHANNELS or channel in SERVO_MEDIUM_SLOW_OPEN_CHANNELS
        ) and target_state == "open"

    def _slow_open_timing(self, channel: int) -> tuple[float, float]:
        if channel in SERVO_MEDIUM_SLOW_OPEN_CHANNELS:
            return SERVO_MEDIUM_SLOW_OPEN_SECONDS, SERVO_MEDIUM_SLOW_OPEN_STEP_SECONDS

        return SERVO_SLOW_OPEN_SECONDS, SERVO_SLOW_OPEN_STEP_SECONDS

    def _uses_slow_close(self, channel: int, target_state: ServoStableState) -> bool:
        return channel in SERVO_SLOW_CLOSE_CHANNELS and target_state == "closed"

    def _uses_slow_transition(self, channel: int, target_state: ServoStableState) -> bool:
        return self._uses_slow_open(channel, target_state) or self._uses_slow_close(
            channel,
            target_state,
        )

    def _can_start_transition(
        self,
        current_state: ServoState,
        target_state: ServoStableState,
    ) -> bool:
        return target_state == "closed" and current_state in ("opening", "closing")

    def _transition_state_for_target(self, target_state: ServoStableState) -> ServoTransitionState:
        return "opening" if target_state == "open" else "closing"

    async def toggle_servo(self, channel: int) -> tuple[list[int], ServoStableState]:
        async with self._lock:
            self._validate_channel(channel)
            self._ensure_available()
            target_state = self._target_state_for_toggle(channel)
            logger.info("servo toggle requested: channel=%s target=%s", channel, target_state)
            channels = await self._start_transitions([channel], target_state)
            return channels, target_state

    async def set_servo(self, channel: int, target_state: ServoStableState) -> list[int]:
        async with self._lock:
            self._validate_channel(channel)
            self._ensure_available()
            logger.info("servo set requested: channel=%s target=%s", channel, target_state)
            return await self._start_transitions([channel], target_state)

    async def set_servo_angle(self, channel: int, angle: float) -> None:
        async with self._lock:
            self._validate_channel(channel)
            self._ensure_available()
            logger.info("servo manual angle requested: channel=%s angle=%s", channel, angle)

            current_state = self._states[channel]
            if current_state in ("opening", "closing"):
                raise ValueError("servo_busy")

            try:
                self._set_manual_angle_sync(channel, angle)
            except Exception as exc:
                logger.exception("failed to move servo channel=%s angle=%s", channel, angle)
                raise ValueError("servo_hardware_error") from exc

            self._states[channel] = "unknown"

    async def set_servos(self, channels: list[int], target_state: ServoStableState) -> list[int]:
        async with self._lock:
            if not channels:
                raise ValueError("invalid_channel")

            for channel in channels:
                self._validate_channel(channel)

            self._ensure_available()
            logger.info("servo batch set requested: channels=%s target=%s", channels, target_state)
            return await self._start_transitions(channels, target_state)

    async def set_all_servos(self, target_state: ServoStableState) -> list[int]:
        async with self._lock:
            self._ensure_available()
            logger.info("servo all set requested: channels=%s target=%s", SERVO_CHANNELS, target_state)
            return await self._start_transitions(list(SERVO_CHANNELS), target_state)

    async def fast_close_all_servos(self) -> None:
        async with self._lock:
            self._ensure_available()
            logger.warning("servo fast close all requested: channels=%s", SERVO_CHANNELS)

            for channel in SERVO_CHANNELS:
                try:
                    self._set_angle_sync(channel, "closed")
                except Exception as exc:
                    logger.exception("failed fast close servo channel=%s", channel)
                    raise ValueError("servo_hardware_error") from exc

                self._states[channel] = "closed"

    async def _start_transitions(self, channels: list[int], target_state: ServoStableState) -> list[int]:
        for channel in channels:
            current_state = self._states[channel]
            if self._can_start_transition(current_state, target_state):
                continue
            if current_state in ("opening", "closing"):
                raise ValueError("servo_busy")

        transition_state = self._transition_state_for_target(target_state)
        started_channels: list[int] = []

        for channel in channels:
            if self._states[channel] == target_state:
                continue
            if self._states[channel] == "closing" and target_state == "closed":
                continue

            try:
                if not self._uses_slow_transition(channel, target_state):
                    self._set_angle_sync(channel, target_state)
            except Exception as exc:
                logger.exception("failed to move servo channel=%s target=%s", channel, target_state)
                raise ValueError("servo_hardware_error") from exc

            self._states[channel] = transition_state
            started_channels.append(channel)

        return started_channels

    async def _slow_move_channel(
        self,
        channel: int,
        target_state: ServoStableState,
        seconds: float,
        step_seconds: float,
    ) -> None:
        start_angle = self._angles[channel]
        if start_angle is None:
            start_angle = (
                self._close_angles[channel]
                if target_state == "open"
                else self._open_angles[channel]
            )

        target_angle = self._target_angle(channel, target_state)
        transition_state = self._transition_state_for_target(target_state)
        step_count = max(1, round(seconds / step_seconds))
        step_sleep = seconds / step_count

        logger.info(
            "servo slow %s started: channel=%s from=%s to=%s seconds=%s",
            target_state,
            channel,
            start_angle,
            target_angle,
            seconds,
        )

        for step in range(1, step_count + 1):
            await asyncio.sleep(step_sleep)
            async with self._lock:
                if self._states[channel] != transition_state:
                    logger.info("servo slow %s interrupted: channel=%s", target_state, channel)
                    return

                angle = start_angle + (target_angle - start_angle) * (step / step_count)
                try:
                    self._servos[channel].angle = angle
                except Exception as exc:
                    logger.exception(
                        "failed slow %s servo channel=%s angle=%s",
                        target_state,
                        channel,
                        angle,
                    )
                    raise ValueError("servo_hardware_error") from exc

                self._angles[channel] = angle

        async with self._lock:
            if self._states[channel] != transition_state:
                logger.info("servo slow %s interrupted: channel=%s", target_state, channel)
                return

            self._servos[channel].angle = target_angle
            self._angles[channel] = target_angle
        logger.info(
            "servo slow %s finished: channel=%s angle=%s",
            target_state,
            channel,
            target_angle,
        )

    async def _slow_open_channel(self, channel: int) -> None:
        seconds, step_seconds = self._slow_open_timing(channel)
        await self._slow_move_channel(
            channel,
            "open",
            seconds,
            step_seconds,
        )

    async def _slow_close_channel(self, channel: int) -> None:
        await self._slow_move_channel(
            channel,
            "closed",
            SERVO_SLOW_CLOSE_SECONDS,
            SERVO_SLOW_CLOSE_STEP_SECONDS,
        )

    async def finish_transitions(
        self,
        channels: list[int],
        target_state: ServoStableState,
    ) -> None:
        if not channels:
            return

        if len(channels) != 1:
            await asyncio.gather(
                *(self.finish_transitions([channel], target_state) for channel in channels)
            )
            return

        channel = channels[0]
        transition_state = self._transition_state_for_target(target_state)

        if self._uses_slow_open(channel, target_state):
            await self._slow_open_channel(channel)
        elif self._uses_slow_close(channel, target_state):
            await self._slow_close_channel(channel)
        else:
            await asyncio.sleep(SERVO_TRANSITION_SECONDS)

        async with self._lock:
            for channel in channels:
                if self._states[channel] == transition_state:
                    self._states[channel] = target_state
                    logger.info(
                        "servo transition finished: channel=%s state=%s",
                        channel,
                        target_state,
                    )
