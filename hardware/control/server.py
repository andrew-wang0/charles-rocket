from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

from .constants import HOST, PORT
from .controllers import ServoController, ServoStableState

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

servo_controller = ServoController()
clients: set[Any] = set()
client_send_locks: dict[Any, asyncio.Lock] = {}


def state_payload() -> dict[str, Any]:
    return {
        "type": "state",
        "servo": servo_controller.state_payload(),
    }


async def send_text(websocket: Any, payload: str) -> bool:
    lock = client_send_locks.get(websocket)
    if lock is None:
        return False

    try:
        async with lock:
            await websocket.send(payload)
        return True
    except Exception:
        return False


async def send_json(websocket: Any, payload: dict[str, Any]) -> bool:
    return await send_text(websocket, json.dumps(payload))


async def send_error(websocket: Any, reason: str) -> None:
    await send_json(websocket, {"type": "error", "error": reason})


async def broadcast_state() -> None:
    payload = json.dumps(state_payload())
    disconnected = []

    for websocket in tuple(clients):
        sent = await send_text(websocket, payload)
        if not sent:
            disconnected.append(websocket)

    for websocket in disconnected:
        clients.discard(websocket)
        client_send_locks.pop(websocket, None)


def parse_channel(raw_channel: Any) -> int:
    if isinstance(raw_channel, bool) or not isinstance(raw_channel, int):
        raise ValueError("invalid_channel")
    return raw_channel


async def run_transition(channels: list[int], target_state: ServoStableState) -> None:
    await broadcast_state()
    if not channels:
        return

    await servo_controller.finish_transitions(channels, target_state)
    await broadcast_state()


async def set_single_servo(
    websocket: Any,
    data: dict[str, Any],
    target_state: ServoStableState,
) -> None:
    try:
        channels = await servo_controller.set_servo(parse_channel(data.get("channel")), target_state)
    except ValueError as exc:
        await send_error(websocket, str(exc))
        return

    await run_transition(channels, target_state)


async def set_all_servos(target_state: ServoStableState) -> None:
    channels = await servo_controller.set_all_servos(target_state)
    await run_transition(channels, target_state)


async def toggle_servo(websocket: Any, data: dict[str, Any]) -> None:
    try:
        channel = parse_channel(data.get("channel"))
        channels, target_state = await servo_controller.toggle_servo(channel)
    except ValueError as exc:
        await send_error(websocket, str(exc))
        return

    await run_transition(channels, target_state)


async def handle_message(websocket: Any, message: str) -> None:
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        await send_error(websocket, "invalid_json")
        return

    if not isinstance(data, dict):
        await send_error(websocket, "invalid_payload")
        return

    command = data.get("command")
    if command == "get_state":
        await send_json(websocket, state_payload())
        return

    if command == "toggle_servo":
        await toggle_servo(websocket, data)
        return

    if command == "open_servo":
        await set_single_servo(websocket, data, "open")
        return

    if command == "close_servo":
        await set_single_servo(websocket, data, "closed")
        return

    if command == "open_all_servos":
        try:
            await set_all_servos("open")
        except ValueError as exc:
            await send_error(websocket, str(exc))
        return

    if command == "close_all_servos":
        try:
            await set_all_servos("closed")
        except ValueError as exc:
            await send_error(websocket, str(exc))
        return

    await send_error(websocket, "unknown_command")


async def handler(websocket: Any, _path: str | None = None) -> None:
    clients.add(websocket)
    client_send_locks[websocket] = asyncio.Lock()

    await send_json(websocket, state_payload())

    try:
        async for message in websocket:
            if not isinstance(message, str):
                await send_error(websocket, "invalid_message_type")
                continue

            await handle_message(websocket, message)
    except ConnectionClosed as exc:
        close_code = exc.rcvd.code if exc.rcvd is not None else getattr(websocket, "close_code", None)
        close_reason = (
            exc.rcvd.reason
            if exc.rcvd is not None and exc.rcvd.reason
            else getattr(websocket, "close_reason", None) or "none"
        )
        logging.info("connection closed: code=%s reason=%s", close_code, close_reason)
    finally:
        clients.discard(websocket)
        client_send_locks.pop(websocket, None)


async def main() -> None:
    logging.info("Starting Charles hardware websocket server on ws://%s:%s", HOST, PORT)

    try:
        async with websockets.serve(handler, HOST, PORT):
            await asyncio.Future()
    except asyncio.CancelledError:
        logging.info("server cancelled")
    finally:
        servo_controller.close()
