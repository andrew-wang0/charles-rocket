from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any, cast

import websockets
from websockets.exceptions import ConnectionClosed

from calibration import CalibrationSet
from config import HOST, PORT, PRESSURE_TRANSDUCER_COUNT, SERVO_CHANNELS
from control.ignition import IgnitionController, IgnitionStableState
from control.servo import ServoController, ServoStableState
from read import LoadSampler, PressureSampler

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

servo_controller: ServoController | None = None
ignition_controller: IgnitionController | None = None
pressure_sampler: PressureSampler | None = None
load_sampler: LoadSampler | None = None
clients: set[Any] = set()
client_send_locks: dict[Any, asyncio.Lock] = {}
transition_tasks: set[asyncio.Task[None]] = set()


def initialize_control_runtime(calibration_set: CalibrationSet) -> None:
    global servo_controller, ignition_controller
    servo_controller = ServoController(calibration_set.servo)
    ignition_controller = IgnitionController()


def build_empty_pressure_payload() -> list[list[dict[str, float | int]]]:
    return [[] for _ in range(PRESSURE_TRANSDUCER_COUNT)]


def get_servo_controller() -> ServoController:
    if servo_controller is None:
        raise RuntimeError("servo controller not initialized")

    return servo_controller


def get_pressure_sampler() -> PressureSampler:
    if pressure_sampler is None:
        raise RuntimeError("pressure sampler not initialized")

    return pressure_sampler


def get_load_sampler() -> LoadSampler:
    if load_sampler is None:
        raise RuntimeError("load sampler not initialized")

    return load_sampler


def get_ignition_controller() -> IgnitionController:
    if ignition_controller is None:
        raise RuntimeError("ignition controller not initialized")

    return ignition_controller


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
        get_servo_controller().state_payload()["channels"],
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


def build_ignition_snapshot() -> dict[str, Any]:
    return get_ignition_controller().state_payload()


def build_readings_result(include_history: bool = False) -> dict[str, Any]:
    servo = get_servo_controller()

    return {
        "status": {
            "servoControllerOk": servo.available,
            "pressureSensorsOk": (
                pressure_sampler.status_payload()
                if pressure_sampler is not None
                else [False] * PRESSURE_TRANSDUCER_COUNT
            ),
            "loadSensorOk": (
                load_sampler.status_payload()
                if load_sampler is not None
                else False
            ),
        },
        "data": {
            "load": (
                (
                    load_sampler.history_payload()
                    if include_history
                    else load_sampler.latest_payload()
                )
                if load_sampler is not None
                else []
            ),
            "pressure": (
                (
                    pressure_sampler.history_payload()
                    if include_history
                    else pressure_sampler.latest_payload()
                )
                if pressure_sampler is not None
                else build_empty_pressure_payload()
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


def parse_servo_channel(value: Any) -> int:
    index = int(value)
    return SERVO_CHANNEL_BY_INDEX[index]


def parse_servo_channels(value: Any) -> list[int]:
    if not isinstance(value, list) or not value:
        raise ValueError("Invalid params")

    channels: list[int] = []
    seen: set[int] = set()

    for entry in value:
        channel = parse_servo_channel(entry)

        if channel in seen:
            raise ValueError("Invalid params")

        seen.add(channel)
        channels.append(channel)

    return channels


def parse_ignition_target(value: Any) -> IgnitionStableState:
    normalized = str(value).upper()

    if normalized == "ON":
        return "ON"

    if normalized == "OFF":
        return "OFF"

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


async def broadcast_ignition_state(*, exclude: Any | None = None) -> None:
    await broadcast_json(
        notify("ignitionState", build_ignition_snapshot()),
        exclude=exclude,
    )


async def finish_servo_transition(
    channels: list[int],
    target_state: ServoStableState,
) -> None:
    try:
        await get_servo_controller().finish_transitions(channels, target_state)
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


def initialize_sensor_runtime_sync(calibration_set: CalibrationSet) -> tuple[PressureSampler, LoadSampler]:
    return PressureSampler(calibration_set.pressure), LoadSampler(calibration_set.load)


async def initialize_and_start_sensor_samplers(calibration_set: CalibrationSet) -> None:
    global pressure_sampler, load_sampler

    pressure, load = await asyncio.to_thread(initialize_sensor_runtime_sync, calibration_set)
    pressure_sampler = pressure
    load_sampler = load
    pressure_sampler.start()
    load_sampler.start()


async def finalize_servo_control(
    websocket: Any,
    transitioned_channels: list[int],
    target_state: ServoStableState,
) -> dict[str, Any]:
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


async def handle_servo_control(
    websocket: Any,
    params: Any,
) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise ValueError("Invalid params")

    try:
        channel = parse_servo_channel(params["index"])
        target_state = parse_servo_target(params["set"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid params") from exc

    try:
        transitioned_channels = await get_servo_controller().set_servo(channel, target_state)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    return await finalize_servo_control(websocket, transitioned_channels, target_state)


async def handle_servo_control_many(
    websocket: Any,
    params: Any,
) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise ValueError("Invalid params")

    try:
        channels = parse_servo_channels(params["indexes"])
        target_state = parse_servo_target(params["set"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid params") from exc

    try:
        transitioned_channels = await get_servo_controller().set_servos(channels, target_state)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    return await finalize_servo_control(websocket, transitioned_channels, target_state)


async def handle_ignition_control(
    websocket: Any,
    params: Any,
) -> dict[str, Any]:
    if not isinstance(params, dict) or "set" not in params:
        raise ValueError("Invalid params")

    try:
        target_state = parse_ignition_target(params["set"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid params") from exc

    try:
        state = await get_ignition_controller().set_state(target_state)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    await broadcast_ignition_state(exclude=websocket)

    return {
        "result": "success",
        "state": state,
    }


async def dispatch_request(
    websocket: Any,
    method: str,
    params: Any,
) -> dict[str, Any]:
    if method == "servoControl":
        return await handle_servo_control(websocket, params)

    if method == "servoControlMany":
        return await handle_servo_control_many(websocket, params)

    if method == "servoState":
        return build_servo_snapshot()

    if method == "ignitionControl":
        return await handle_ignition_control(websocket, params)

    if method == "ignitionState":
        return build_ignition_snapshot()

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


async def serve_websocket_server(calibration_set: CalibrationSet) -> None:
    logging.info("Starting Charles hardware websocket server on ws://%s:%s", HOST, PORT)
    initialize_control_runtime(calibration_set)
    sensor_start_task: asyncio.Task[None] | None = None

    try:
        async with websockets.serve(handler, HOST, PORT):
            logging.info("websocket server listening on ws://%s:%s", HOST, PORT)
            sensor_start_task = asyncio.create_task(
                initialize_and_start_sensor_samplers(calibration_set)
            )
            await asyncio.Future()
    except asyncio.CancelledError:
        logging.info("server cancelled")
    finally:
        if sensor_start_task is not None:
            sensor_start_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sensor_start_task

        for task in tuple(transition_tasks):
            task.cancel()

        await asyncio.gather(*transition_tasks, return_exceptions=True)
        if load_sampler is not None:
            load_sampler.stop()
        if pressure_sampler is not None:
            pressure_sampler.stop()
        if servo_controller is not None:
            servo_controller.close()
        if ignition_controller is not None:
            ignition_controller.close()
