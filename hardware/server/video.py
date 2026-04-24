from __future__ import annotations

import asyncio
import contextlib
import logging

from aiohttp import web

from config import VIDEO_STREAM_FPS, VIDEO_STREAM_HOST, VIDEO_STREAM_PATH, VIDEO_STREAM_PORT
from read import CameraReader

logger = logging.getLogger(__name__)

BOUNDARY = "frame"
camera_reader = CameraReader()


async def wait_for_frame(timeout_seconds: float) -> bytes | None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds

    while asyncio.get_running_loop().time() < deadline:
        frame = camera_reader.latest_frame()
        if frame is not None:
            return frame
        await asyncio.sleep(0.1)

    return None


async def camera_stream(_request: web.Request) -> web.StreamResponse:
    frame = await wait_for_frame(timeout_seconds=1.0)
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
    await response.prepare(_request)

    last_frame_time = -1
    frame_interval = 1 / VIDEO_STREAM_FPS

    try:
        while True:
            frame = camera_reader.latest_frame()
            frame_time = camera_reader.latest_frame_time_ms()

            if frame is None or frame_time == last_frame_time:
                await asyncio.sleep(frame_interval)
                continue

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
            await asyncio.sleep(frame_interval)
    except asyncio.CancelledError:
        raise
    except (ConnectionResetError, BrokenPipeError):
        pass
    except Exception:
        logger.exception("video stream failed")
    finally:
        with contextlib.suppress(Exception):
            await response.write_eof()

    return response


async def serve_video_server() -> None:
    app = web.Application()
    app.router.add_get(VIDEO_STREAM_PATH, camera_stream)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, VIDEO_STREAM_HOST, VIDEO_STREAM_PORT)

    logger.info(
        "starting video server on http://%s:%s%s",
        VIDEO_STREAM_HOST,
        VIDEO_STREAM_PORT,
        VIDEO_STREAM_PATH,
    )
    camera_reader.start()
    await site.start()

    try:
        await asyncio.Future()
    except asyncio.CancelledError:
        logger.info("video server cancelled")
        raise
    finally:
        camera_reader.stop()
        await runner.cleanup()
