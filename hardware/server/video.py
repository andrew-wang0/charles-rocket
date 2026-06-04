from __future__ import annotations

import asyncio
import contextlib
import logging
import shlex
import shutil
import time
from pathlib import Path
from typing import cast

from aiohttp import web

from config import (
    VIDEO_CAPTURE_FPS,
    VIDEO_DEVICE_PATH,
    VIDEO_FRAME_HEIGHT,
    VIDEO_FRAME_WIDTH,
    VIDEO_H264_INPUT_FORMAT,
    VIDEO_HLS_LIST_SIZE,
    VIDEO_HLS_SEGMENT_PATH,
    VIDEO_HLS_SEGMENT_SECONDS,
    VIDEO_RECORD_ENABLED,
    VIDEO_RECORD_WINDOW_SECONDS,
    VIDEO_RETRY_SECONDS,
    VIDEO_STREAM_HOST,
    VIDEO_STREAM_PATH,
    VIDEO_STREAM_PORT,
)

logger = logging.getLogger(__name__)

H264_STREAMER_APP_KEY = "h264_streamer"
HLS_PLAYLIST_NAME = "camera.m3u8"
HLS_SEGMENT_PREFIX = "camera-"
HLS_SEGMENT_SUFFIX = ".ts"
VIDEO_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "video"
VIDEO_SHUTDOWN_TIMEOUT_SECONDS = 0.1
FFMPEG_SHUTDOWN_TIMEOUT_SECONDS = 2.0
HLS_PRUNE_INTERVAL_SECONDS = 30


def get_h264_streamer(request: web.Request) -> "H264HlsStreamer":
    return cast(H264HlsStreamer, request.app[H264_STREAMER_APP_KEY])


def hls_segment_base_url() -> str:
    return VIDEO_HLS_SEGMENT_PATH.split("{filename}", 1)[0]


class H264HlsStreamer:
    def __init__(self) -> None:
        self.available = shutil.which("ffmpeg") is not None
        self.error = None if self.available else "`ffmpeg` command not found"
        self._data_dir = VIDEO_DATA_DIR
        self._playlist_path = self._data_dir / HLS_PLAYLIST_NAME
        self._process: asyncio.subprocess.Process | None = None
        self._task: asyncio.Task[None] | None = None
        self._stopping = False

    @property
    def playlist_path(self) -> Path:
        return self._playlist_path

    def segment_path(self, filename: str) -> Path | None:
        if Path(filename).name != filename:
            return None

        if not filename.startswith(HLS_SEGMENT_PREFIX) or not filename.endswith(HLS_SEGMENT_SUFFIX):
            return None

        return self._data_dir / filename

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return

        self._stopping = False
        self._data_dir.mkdir(parents=True, exist_ok=True)
        with contextlib.suppress(FileNotFoundError):
            self._playlist_path.unlink()

        self._task = asyncio.create_task(self._run(), name="h264-hls-streamer")

    async def stop(self) -> None:
        self._stopping = True
        await self._stop_process()

        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        if not self.available:
            logger.warning("H.264 video stream unavailable: %s", self.error)
            await asyncio.Future()

        while not self._stopping:
            self._delete_expired_chunks(int(time.time() * 1000))
            command = self._build_ffmpeg_command()
            logger.info("starting H.264 video stream: %s", shlex.join(command))

            try:
                self._process = await asyncio.create_subprocess_exec(
                    *command,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
            except Exception as exc:
                self.error = str(exc)
                logger.exception("failed to start H.264 video stream")
                await asyncio.sleep(VIDEO_RETRY_SECONDS)
                continue

            stderr_task = asyncio.create_task(
                self._log_process_stderr(self._process),
                name="h264-hls-stderr",
            )
            prune_task = asyncio.create_task(
                self._prune_loop(),
                name="h264-hls-pruner",
            )

            try:
                return_code = await self._process.wait()
            finally:
                self._process = None
                stderr_task.cancel()
                prune_task.cancel()
                await asyncio.gather(stderr_task, prune_task, return_exceptions=True)

            if self._stopping:
                return

            logger.warning(
                "H.264 video stream exited with code %s; retrying in %.1fs",
                return_code,
                VIDEO_RETRY_SECONDS,
            )
            await asyncio.sleep(VIDEO_RETRY_SECONDS)

    def _build_ffmpeg_command(self) -> list[str]:
        segment_seconds = max(1, int(VIDEO_HLS_SEGMENT_SECONDS))
        capture_fps = max(1, int(VIDEO_CAPTURE_FPS))
        segment_path = self._data_dir / f"{HLS_SEGMENT_PREFIX}%s{HLS_SEGMENT_SUFFIX}"

        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-fflags",
            "nobuffer",
            "-flags",
            "low_delay",
            "-f",
            "v4l2",
        ]

        if VIDEO_H264_INPUT_FORMAT:
            command.extend(["-input_format", VIDEO_H264_INPUT_FORMAT])

        command.extend([
            "-framerate",
            str(capture_fps),
            "-video_size",
            f"{VIDEO_FRAME_WIDTH}x{VIDEO_FRAME_HEIGHT}",
            "-i",
            VIDEO_DEVICE_PATH,
            "-an",
            "-c:v",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            str(segment_seconds),
            "-hls_list_size",
            str(max(1, int(VIDEO_HLS_LIST_SIZE))),
            "-hls_flags",
            "independent_segments+omit_endlist+program_date_time+temp_file",
            "-hls_base_url",
            hls_segment_base_url(),
            "-strftime",
            "1",
            "-hls_segment_filename",
            str(segment_path),
            str(self._playlist_path),
        ])

        return command

    async def _log_process_stderr(self, process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return

        while True:
            line = await process.stderr.readline()
            if not line:
                return

            message = line.decode("utf-8", errors="replace").strip()
            if message:
                logger.warning("video ffmpeg: %s", message)

    async def _prune_loop(self) -> None:
        while True:
            await asyncio.sleep(HLS_PRUNE_INTERVAL_SECONDS)
            self._delete_expired_chunks(int(time.time() * 1000))

    async def _stop_process(self) -> None:
        process = self._process
        if process is None or process.returncode is not None:
            return

        process.terminate()

        try:
            await asyncio.wait_for(process.wait(), timeout=FFMPEG_SHUTDOWN_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    def _delete_expired_chunks(self, now_ms: int) -> None:
        if VIDEO_RECORD_ENABLED:
            retention_seconds = VIDEO_RECORD_WINDOW_SECONDS
        else:
            retention_seconds = VIDEO_HLS_SEGMENT_SECONDS * (VIDEO_HLS_LIST_SIZE + 3)

        cutoff_ms = now_ms - retention_seconds * 1000

        for path in self._data_dir.glob(f"{HLS_SEGMENT_PREFIX}*{HLS_SEGMENT_SUFFIX}"):
            timestamp_ms = self._parse_segment_timestamp(path)
            if timestamp_ms is None or timestamp_ms >= cutoff_ms:
                continue

            try:
                path.unlink()
                logger.info("deleted expired H.264 video segment: path=%s", path)
            except Exception:
                logger.exception("failed to delete expired H.264 video segment: path=%s", path)

    def _parse_segment_timestamp(self, path: Path) -> int | None:
        name = path.stem

        if not name.startswith(HLS_SEGMENT_PREFIX):
            return None

        try:
            value = int(name[len(HLS_SEGMENT_PREFIX):])
        except ValueError:
            return None

        return value if value >= 1_000_000_000_000 else value * 1000


async def hls_playlist(request: web.Request) -> web.StreamResponse:
    streamer = get_h264_streamer(request)
    path = streamer.playlist_path

    if not path.exists():
        raise web.HTTPServiceUnavailable(text="NO VIDEO SIGNAL")

    return web.Response(
        body=path.read_bytes(),
        content_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


async def hls_segment(request: web.Request) -> web.StreamResponse:
    streamer = get_h264_streamer(request)
    filename = request.match_info.get("filename", "")
    path = streamer.segment_path(filename)

    if path is None or not path.exists():
        raise web.HTTPNotFound()

    return web.FileResponse(
        path,
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Type": "video/mp2t",
        },
    )


async def serve_video_server() -> None:
    app = web.Application()
    h264_streamer = H264HlsStreamer()
    app[H264_STREAMER_APP_KEY] = h264_streamer
    app.router.add_get(VIDEO_STREAM_PATH, hls_playlist)
    app.router.add_get(VIDEO_HLS_SEGMENT_PATH, hls_segment)

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

    h264_streamer.start()
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
        await h264_streamer.stop()
        await runner.cleanup()
