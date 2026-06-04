from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import cast

from aiohttp import web

from config import VIDEO_STREAM_FPS, VIDEO_STREAM_HOST, VIDEO_STREAM_PATH, VIDEO_STREAM_PORT
from read import CameraReader

logger = logging.getLogger(__name__)

BOUNDARY = "frame"
CAMERA_READER_APP_KEY = "camera_reader"
VIDEO_SHUTDOWN_TIMEOUT_SECONDS = 0.1
INITIAL_FRAME_TIMEOUT_SECONDS = 1.0


def get_camera_reader(request: web.Request) -> CameraReader:
    return cast(CameraReader, request.app[CAMERA_READER_APP_KEY])


async def wait_for_frame(camera_reader: CameraReader, timeout_seconds: float) -> bytes | None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds

    while loop.time() < deadline:
        frame = camera_reader.latest_frame()
        if frame is not None:
            return frame
        await asyncio.sleep(0.1)

    return None


async def camera_stream(request: web.Request) -> web.StreamResponse:
    camera_reader = get_camera_reader(request)
    frame = await wait_for_frame(camera_reader, timeout_seconds=INITIAL_FRAME_TIMEOUT_SECONDS)
    if frame is None:
        raise web.HTTPServiceUnavailable(text="NO VIDEO SIGNAL")

    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Connection": "close",
        },
    )
    await response.prepare(request)

    loop = asyncio.get_running_loop()
    last_frame_time = -1
    frame_interval = 1 / max(1, VIDEO_STREAM_FPS)
    poll_interval = min(frame_interval / 2, 0.005)
    last_send_time = 0.0

    try:
        while True:
            frame = camera_reader.latest_frame()
            frame_time = camera_reader.latest_frame_time_ms()

            if frame is None or frame_time == last_frame_time:
                await asyncio.sleep(poll_interval)
                continue

            delay = (last_send_time + frame_interval) - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)

            last_frame_time = frame_time
            await response.write(
                (
                    f"--{BOUNDARY}\r\n"
                    "Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(frame)}\r\n\r\n"
                ).encode("ascii")
            )
            await response.write(frame)
            await response.write(b"\r\n")
            last_send_time = loop.time()
    except asyncio.CancelledError:
        raise
    except (ConnectionError, ConnectionResetError, BrokenPipeError):
        pass
    except Exception:
        logger.exception("video stream failed")
    finally:
        with contextlib.suppress(Exception):
            await response.write_eof()

    return response


async def serve_video_server() -> None:
    camera_reader = CameraReader()
    if not camera_reader.available:
        logger.warning("camera reader unavailable: %s", camera_reader.error or "unknown_error")

    app = web.Application()
    app[CAMERA_READER_APP_KEY] = camera_reader
    app.router.add_get(VIDEO_STREAM_PATH, camera_stream)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(
        runner,
        VIDEO_STREAM_HOST,
        VIDEO_STREAM_PORT,
        shutdown_timeout=VIDEO_SHUTDOWN_TIMEOUT_SECONDS,
    )

    logger.info(
        "starting video server on http://%s:%s%s",
        VIDEO_STREAM_HOST,
        VIDEO_STREAM_PORT,
        VIDEO_STREAM_PATH,
    )
    camera_reader.start()
    await site.start()
    logger.info(
        "video server listening on http://%s:%s%s",
        VIDEO_STREAM_HOST,
        VIDEO_STREAM_PORT,
        VIDEO_STREAM_PATH,
    )

    try:
        await asyncio.Future()
    except asyncio.CancelledError:
        raise
    finally:
        camera_reader.stop()
        await runner.cleanup()
