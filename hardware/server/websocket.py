from __future__ import annotations

import asyncio
import json
import logging
import math
from typing import Any, cast

import websockets
from websockets.exceptions import ConnectionClosed

from calibration import CalibrationSet
from config import HOST, PORT, PRESSURE_TRANSDUCER_COUNT, SERVO_ACTUATION_RANGE, SERVO_CHANNELS
from control.ignition import IgnitionController, IgnitionStableState
from control.servo import ServoController, ServoStableState
from read import LoadSampler, PressureSampler

logger = logging.getLogger(__name__)

JSONRPC_VERSION = "2.0"
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
SERVER_ERROR = -32000
WEBSOCKET_CLOSE_TIMEOUT_SECONDS = 0.1

SERVO_CHANNEL_BY_INDEX = {
    index: channel for index, channel in enumerate(SERVO_CHANNELS)
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
startup_tasks: set[asyncio.Task[None]] = set()


def initialize_control_runtime(calibration_set: CalibrationSet) -> None:
    global servo_controller, ignition_controller
    servo_controller = ServoController(calibration_set.servo)
    ignition_controller = IgnitionController()

    if not servo_controller.available:
        logger.warning(
            "servo controller unavailable: %s",
            servo_controller.error or "unknown_error",
        )

    if not ignition_controller.available:
        logger.warning(
            "ignition controller unavailable: %s",
            ignition_controller.error or "unknown_error",
        )


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


def parse_servo_angle(value: Any) -> float:
    angle = float(value)

    if not math.isfinite(angle) or angle < 0 or angle > SERVO_ACTUATION_RANGE:
        raise ValueError("Invalid params")

    return angle


def parse_ignition_target(value: Any) -> IgnitionStableState:
    normalized = str(value).upper()

    if normalized == "ON":
        return "ON"

    if normalized == "OFF":
        return "OFF"

    raise ValueError("Invalid params")


def parse_pressure_index(value: Any) -> int:
    index = int(value)

    if index < 0 or index >= PRESSURE_TRANSDUCER_COUNT:
        raise ValueError("Invalid params")

    return index


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
        logger.exception(
            "failed to finish servo transition: channels=%s target=%s",
            channels,
            target_state,
        )


def track_background_task(
    task: asyncio.Task[None],
    task_set: set[asyncio.Task[None]],
    label: str,
) -> None:
    task_set.add(task)

    def cleanup(done: asyncio.Task[None]) -> None:
        task_set.discard(done)

        if done.cancelled():
            return

        exception = done.exception()
        if exception is not None:
            logger.error(
                "%s failed",
                label,
                exc_info=(type(exception), exception, exception.__traceback__),
            )

    task.add_done_callback(cleanup)


def track_transition_task(task: asyncio.Task[None]) -> None:
    track_background_task(task, transition_tasks, "background servo task")


def track_startup_task(task: asyncio.Task[None], label: str) -> None:
    track_background_task(task, startup_tasks, label)


async def initialize_sampler(
    sampler_type: type[PressureSampler] | type[LoadSampler],
    calibration: Any,
    label: str,
) -> PressureSampler | LoadSampler | None:
    try:
        sampler = sampler_type(calibration)
        sampler.start()
        if not sampler.available:
            logger.warning("%s sampler unavailable: %s", label, sampler.error or "unknown_error")
        return sampler
    except Exception:
        logger.exception("failed to start %s sampler", label)
        return None


async def initialize_pressure_sampler(calibration: Any) -> None:
    global pressure_sampler

    pressure = await initialize_sampler(PressureSampler, calibration, "pressure")
    pressure_sampler = cast(PressureSampler | None, pressure)


async def initialize_load_sampler(calibration: Any) -> None:
    global load_sampler

    load = await initialize_sampler(LoadSampler, calibration, "load")
    load_sampler = cast(LoadSampler | None, load)


def start_sensor_startup_tasks(calibration_set: CalibrationSet) -> None:
    track_startup_task(
        asyncio.create_task(initialize_pressure_sampler(calibration_set.pressure)),
        "pressure startup task",
    )
    track_startup_task(
        asyncio.create_task(initialize_load_sampler(calibration_set.load)),
        "load startup task",
    )


def stop_runtime_component(component: Any, action: str, label: str) -> None:
    if component is None:
        return

    try:
        getattr(component, action)()
    except Exception:
        logger.exception("failed to %s %s", action, label)


async def shutdown_runtime() -> None:
    global servo_controller, ignition_controller, pressure_sampler, load_sampler

    for task in tuple(startup_tasks):
        task.cancel()

    await asyncio.gather(*startup_tasks, return_exceptions=True)
    startup_tasks.clear()

    for task in tuple(transition_tasks):
        task.cancel()

    await asyncio.gather(*transition_tasks, return_exceptions=True)
    transition_tasks.clear()

    stop_runtime_component(load_sampler, "stop", "load sampler")
    stop_runtime_component(pressure_sampler, "stop", "pressure sampler")
    stop_runtime_component(servo_controller, "close", "servo controller")
    stop_runtime_component(ignition_controller, "close", "ignition controller")

    load_sampler = None
    pressure_sampler = None
    servo_controller = None
    ignition_controller = None


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


async def handle_servo_set_angle(
    websocket: Any,
    params: Any,
) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise ValueError("Invalid params")

    try:
        channel = parse_servo_channel(params["index"])
        angle = parse_servo_angle(params["angle"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid params") from exc

    try:
        await get_servo_controller().set_servo_angle(channel, angle)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    snapshot = build_servo_snapshot()
    await broadcast_servo_state(exclude=websocket)

    return {
        "result": "success",
        "index": SERVO_INDEX_BY_CHANNEL[channel],
        "angle": angle,
        **snapshot,
    }


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


async def handle_tare(
    _websocket: Any,
    params: Any,
) -> dict[str, Any]:
    if not isinstance(params, dict) or params.get("device") != "pressure" or "index" not in params:
        raise ValueError("Invalid params")

    try:
        channel_index = parse_pressure_index(params["index"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid params") from exc

    try:
        tare_value = get_pressure_sampler().tare(channel_index)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    return {
        "device": "pressure",
        "index": channel_index,
        "value": tare_value,
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

    if method == "servoSetAngle":
        return await handle_servo_set_angle(websocket, params)

    if method == "servoState":
        return build_servo_snapshot()

    if method == "ignitionControl":
        return await handle_ignition_control(websocket, params)

    if method == "ignitionState":
        return build_ignition_snapshot()

    if method == "readings":
        include_history = isinstance(params, dict) and bool(params.get("history"))
        return build_readings_result(include_history=include_history)

    if method == "tare":
        return await handle_tare(websocket, params)

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
        logger.exception("unhandled rpc error: method=%s", method)
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
        logger.info("connection closed: code=%s reason=%s", close_code, close_reason)
    finally:
        clients.discard(websocket)
        client_send_locks.pop(websocket, None)


async def serve_websocket_server(calibration_set: CalibrationSet) -> None:
    logger.info("Starting Charles hardware websocket server on ws://%s:%s", HOST, PORT)
    initialize_control_runtime(calibration_set)

    try:
        async with websockets.serve(
            handler,
            HOST,
            PORT,
            close_timeout=WEBSOCKET_CLOSE_TIMEOUT_SECONDS,
        ):
            logger.info("websocket server listening on ws://%s:%s", HOST, PORT)
            start_sensor_startup_tasks(calibration_set)
            await asyncio.Future()
    except asyncio.CancelledError:
        raise
    finally:
        await shutdown_runtime()
