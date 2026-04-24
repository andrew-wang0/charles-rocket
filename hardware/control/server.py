from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, cast

import websockets
from websockets.exceptions import ConnectionClosed

from .constants import HOST, PORT, SERVO_CHANNELS
from .controllers import ServoController, ServoStableState
from .load import LoadSampler
from .pressure import PressureSampler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

JSONRPC_VERSION = "2.0"
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
SERVER_ERROR = -32000

SERVO_CHANNEL_BY_INDEX = {
    index: channel for index, channel in enumerate(SERVO_CHANNELS, start=1)
}
SERVO_INDEX_BY_CHANNEL = {
    channel: index for index, channel in SERVO_CHANNEL_BY_INDEX.items()
}

servo_controller = ServoController()
pressure_sampler = PressureSampler()
load_sampler = LoadSampler()
ignition_state = "UNKNOWN"
clients: set[Any] = set()
client_send_locks: dict[Any, asyncio.Lock] = {}
transition_tasks: set[asyncio.Task[None]] = set()


def ok(request_id: Any, result: Any) -> dict[str, Any]:
    return {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "result": result,
    }


def err(
    request_id: Any,
    code: int,
    message: str,
    data: Any | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "error": {
            "code": code,
            "message": message,
        },
    }

    if data is not None:
        payload["error"]["data"] = data

    return payload


def notify(method: str, params: Any) -> dict[str, Any]:
    return {
        "jsonrpc": JSONRPC_VERSION,
        "method": method,
        "params": params,
    }


def build_servo_snapshot() -> dict[str, list[dict[str, Any]]]:
    channels = sorted(
        servo_controller.state_payload()["channels"],
        key=lambda channel_state: SERVO_INDEX_BY_CHANNEL[channel_state["channel"]],
    )

    return {
        "states": [
            {
                "index": SERVO_INDEX_BY_CHANNEL[channel_state["channel"]],
                "state": str(channel_state["state"]).upper(),
            }
            for channel_state in channels
        ]
    }


def build_readings_result(include_history: bool = False) -> dict[str, Any]:
    return {
        "status": {
            "servoControllerOk": servo_controller.available,
            "pressureSensorsOk": pressure_sampler.status_payload(),
            "loadSensorOk": load_sampler.status_payload(),
        },
        "data": {
            "load": (
                load_sampler.history_payload()
                if include_history
                else load_sampler.latest_payload()
            ),
            "pressure": (
                pressure_sampler.history_payload()
                if include_history
                else pressure_sampler.latest_payload()
            ),
        },
    }


def parse_servo_target(value: Any) -> ServoStableState:
    normalized = str(value).lower()

    if normalized == "open":
        return cast(ServoStableState, "open")

    if normalized == "closed":
        return cast(ServoStableState, "closed")

    raise ValueError("Invalid params")


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


async def send_json(websocket: Any, payload: Any) -> bool:
    return await send_text(websocket, json.dumps(payload))


async def broadcast_json(payload: Any, *, exclude: Any | None = None) -> None:
    serialized = json.dumps(payload)
    disconnected: list[Any] = []

    for websocket in tuple(clients):
        if websocket == exclude:
            continue

        sent = await send_text(websocket, serialized)
        if not sent:
            disconnected.append(websocket)

    for websocket in disconnected:
        clients.discard(websocket)
        client_send_locks.pop(websocket, None)


async def broadcast_servo_state(*, exclude: Any | None = None) -> None:
    await broadcast_json(
        notify("servoState", build_servo_snapshot()),
        exclude=exclude,
    )


async def finish_servo_transition(
    channels: list[int],
    target_state: ServoStableState,
) -> None:
    try:
        await servo_controller.finish_transitions(channels, target_state)
        await broadcast_servo_state()
    except Exception:
        logging.exception(
            "failed to finish servo transition: channels=%s target=%s",
            channels,
            target_state,
        )


def track_transition_task(task: asyncio.Task[None]) -> None:
    transition_tasks.add(task)

    def cleanup(done: asyncio.Task[None]) -> None:
        transition_tasks.discard(done)

        if done.cancelled():
            return

        exception = done.exception()
        if exception is not None:
            logging.error(
                "background servo task failed",
                exc_info=(type(exception), exception, exception.__traceback__),
            )

    task.add_done_callback(cleanup)


async def handle_servo_control(
    websocket: Any,
    params: Any,
) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise ValueError("Invalid params")

    try:
        index = int(params["index"])
        channel = SERVO_CHANNEL_BY_INDEX[index]
        target_state = parse_servo_target(params["set"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid params") from exc

    try:
        transitioned_channels = await servo_controller.set_servo(channel, target_state)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    snapshot = build_servo_snapshot()

    if transitioned_channels:
        await broadcast_servo_state(exclude=websocket)
        track_transition_task(
            asyncio.create_task(finish_servo_transition(transitioned_channels, target_state))
        )

    return {
        "result": "success",
        **snapshot,
    }


def handle_ignition_control(params: Any) -> dict[str, Any]:
    global ignition_state

    if not isinstance(params, dict) or "set" not in params:
        raise ValueError("Invalid params")

    ignition_state = str(params["set"]).upper()

    return {
        "result": "success",
        "state": ignition_state,
    }


async def dispatch_request(
    websocket: Any,
    method: str,
    params: Any,
) -> dict[str, Any]:
    if method == "servoControl":
        return await handle_servo_control(websocket, params)

    if method == "servoState":
        return build_servo_snapshot()

    if method == "ignitionControl":
        return handle_ignition_control(params)

    if method == "readings":
        include_history = isinstance(params, dict) and bool(params.get("history"))
        return build_readings_result(include_history=include_history)

    raise LookupError("Method not found")


async def handle_request_payload(
    websocket: Any,
    payload: Any,
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return err(None, INVALID_REQUEST, "Invalid Request")

    request_id = payload.get("id")
    should_respond = "id" in payload
    method = payload.get("method")
    params = payload.get("params")

    if payload.get("jsonrpc") != JSONRPC_VERSION or not isinstance(method, str):
        return err(request_id if should_respond else None, INVALID_REQUEST, "Invalid Request")

    try:
        result = await dispatch_request(websocket, method, params)
    except LookupError:
        if not should_respond:
            return None
        return err(request_id, METHOD_NOT_FOUND, "Method not found")
    except ValueError as exc:
        if not should_respond:
            return None
        return err(request_id, INVALID_PARAMS, str(exc))
    except RuntimeError as exc:
        if not should_respond:
            return None
        return err(request_id, SERVER_ERROR, str(exc))
    except Exception as exc:
        logging.exception("unhandled rpc error: method=%s", method)
        if not should_respond:
            return None
        return err(request_id, INTERNAL_ERROR, "Internal error", {"message": str(exc)})

    if not should_respond:
        return None

    return ok(request_id, result)


async def handle_message(websocket: Any, message: str) -> None:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError as exc:
        await send_json(
            websocket,
            err(None, PARSE_ERROR, "Parse error", {"message": str(exc)}),
        )
        return

    if isinstance(payload, list):
        await send_json(
            websocket,
            err(None, INVALID_REQUEST, "Batch requests are not supported"),
        )
        return

    response = await handle_request_payload(websocket, payload)
    if response is not None:
        await send_json(websocket, response)


async def handler(websocket: Any, _path: str | None = None) -> None:
    clients.add(websocket)
    client_send_locks[websocket] = asyncio.Lock()

    try:
        async for message in websocket:
            if not isinstance(message, str):
                await send_json(
                    websocket,
                    err(None, INVALID_REQUEST, "WebSocket messages must be text"),
                )
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
    pressure_sampler.start()
    load_sampler.start()

    try:
        async with websockets.serve(handler, HOST, PORT):
            await asyncio.Future()
    except asyncio.CancelledError:
        logging.info("server cancelled")
    finally:
        for task in tuple(transition_tasks):
            task.cancel()

        await asyncio.gather(*transition_tasks, return_exceptions=True)
        load_sampler.stop()
        pressure_sampler.stop()
        servo_controller.close()
