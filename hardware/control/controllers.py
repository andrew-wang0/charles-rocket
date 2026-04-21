from __future__ import annotations

import asyncio
from typing import Literal, TypedDict

from .constants import SERVO_CHANNELS, SERVO_TRANSITION_SECONDS

ServoStableState = Literal["open", "closed"]
ServoTransitionState = Literal["opening", "closing"]
ServoState = ServoStableState | ServoTransitionState


class ServoChannelState(TypedDict):
    channel: int
    state: ServoState


class ServoController:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._states: dict[int, ServoState] = {channel: "closed" for channel in SERVO_CHANNELS}

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

    def _target_state_for_toggle(self, channel: int) -> ServoStableState:
        return "closed" if self._states[channel] == "open" else "open"

    async def toggle_servo(self, channel: int) -> tuple[list[int], ServoStableState]:
        async with self._lock:
            self._validate_channel(channel)
            target_state = self._target_state_for_toggle(channel)
            return self._start_transitions([channel], target_state), target_state

    async def set_servo(self, channel: int, target_state: ServoStableState) -> list[int]:
        async with self._lock:
            self._validate_channel(channel)
            return self._start_transitions([channel], target_state)

    async def set_all_servos(self, target_state: ServoStableState) -> list[int]:
        async with self._lock:
            return self._start_transitions(list(SERVO_CHANNELS), target_state)

    def _start_transitions(self, channels: list[int], target_state: ServoStableState) -> list[int]:
        for channel in channels:
            current_state = self._states[channel]
            if current_state in ("opening", "closing"):
                raise ValueError("servo_busy")

        transition_state: ServoTransitionState = "opening" if target_state == "open" else "closing"
        started_channels = []

        for channel in channels:
            if self._states[channel] == target_state:
                continue

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
