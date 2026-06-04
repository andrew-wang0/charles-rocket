from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from pathlib import Path

from config import (
    AUDIO_RECORD_CHANNELS,
    AUDIO_RECORD_CHUNK_SECONDS,
    AUDIO_RECORD_DEVICE,
    AUDIO_RECORD_ENABLED,
    AUDIO_RECORD_SAMPLE_FORMAT,
    AUDIO_RECORD_SAMPLE_RATE,
    AUDIO_RECORD_WINDOW_SECONDS,
)

logger = logging.getLogger(__name__)
AUDIO_SHUTDOWN_TIMEOUT_SECONDS = 1.0
AUDIO_DEVICE_BUSY_RETRY_COUNT = 8
AUDIO_DEVICE_BUSY_RETRY_SECONDS = 0.25


class AudioDeviceBusyError(RuntimeError):
    pass


class WavAudioRecorder:
    def __init__(self) -> None:
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "audio"

    async def run(self) -> None:
        if not AUDIO_RECORD_ENABLED:
            logger.info("audio recording disabled")
            await asyncio.Future()

        self._data_dir.mkdir(parents=True, exist_ok=True)
        logger.info(
            (
                "audio recording enabled: device=%s rate=%sHz channels=%s "
                "format=%s chunk_seconds=%s window_seconds=%s data_dir=%s"
            ),
            AUDIO_RECORD_DEVICE,
            AUDIO_RECORD_SAMPLE_RATE,
            AUDIO_RECORD_CHANNELS,
            AUDIO_RECORD_SAMPLE_FORMAT,
            AUDIO_RECORD_CHUNK_SECONDS,
            AUDIO_RECORD_WINDOW_SECONDS,
            self._data_dir,
        )

        while True:
            timestamp_ms = int(time.time() * 1000)
            self._delete_expired_chunks(timestamp_ms)
            path = self._data_dir / f"audio-{timestamp_ms}.wav"

            try:
                await self._record_chunk(path)
            except asyncio.CancelledError:
                raise
            except FileNotFoundError:
                logger.error("audio recording unavailable: `arecord` command not found")
                await asyncio.sleep(5)
            except AudioDeviceBusyError as exc:
                logger.warning("audio recording skipped because device stayed busy: %s", exc)
                await asyncio.sleep(1)
            except Exception:
                logger.exception("audio recording chunk failed")
                await asyncio.sleep(1)

    async def _record_chunk(self, path: Path) -> None:
        for attempt in range(1, AUDIO_DEVICE_BUSY_RETRY_COUNT + 2):
            try:
                await self._record_chunk_once(path)
                return
            except AudioDeviceBusyError:
                if attempt > AUDIO_DEVICE_BUSY_RETRY_COUNT:
                    raise

                logger.warning(
                    "audio device busy; retrying chunk open: attempt=%s/%s delay=%ss device=%s",
                    attempt,
                    AUDIO_DEVICE_BUSY_RETRY_COUNT,
                    AUDIO_DEVICE_BUSY_RETRY_SECONDS,
                    AUDIO_RECORD_DEVICE,
                )
                await asyncio.sleep(AUDIO_DEVICE_BUSY_RETRY_SECONDS)

    async def _record_chunk_once(self, path: Path) -> None:
        logger.info("audio recording chunk opening: path=%s device=%s", path, AUDIO_RECORD_DEVICE)
        process = await asyncio.create_subprocess_exec(
            "arecord",
            "-D",
            AUDIO_RECORD_DEVICE,
            "-t",
            "wav",
            "-f",
            AUDIO_RECORD_SAMPLE_FORMAT,
            "-c",
            str(AUDIO_RECORD_CHANNELS),
            "-r",
            str(AUDIO_RECORD_SAMPLE_RATE),
            "-d",
            str(AUDIO_RECORD_CHUNK_SECONDS),
            str(path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            _, stderr = await process.communicate()
        except asyncio.CancelledError:
            await self._stop_process(process)
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
            raise

        if process.returncode != 0:
            message = (stderr or b"").decode("utf-8", errors="replace").strip()
            with contextlib.suppress(FileNotFoundError):
                path.unlink()

            if self._is_device_busy_message(message):
                raise AudioDeviceBusyError(message)

            raise RuntimeError(f"arecord exited with code {process.returncode}: {message}")

    def _is_device_busy_message(self, message: str) -> bool:
        return "Device or resource busy" in message

    async def _stop_process(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return

        process.terminate()

        try:
            await asyncio.wait_for(process.wait(), timeout=AUDIO_SHUTDOWN_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    def _delete_expired_chunks(self, now_ms: int) -> None:
        cutoff_ms = now_ms - AUDIO_RECORD_WINDOW_SECONDS * 1000

        for path in self._data_dir.glob("audio-*.wav"):
            timestamp_ms = self._parse_chunk_timestamp(path)
            if timestamp_ms is None or timestamp_ms >= cutoff_ms:
                continue

            try:
                path.unlink()
                logger.info("deleted expired audio recording chunk: path=%s", path)
            except Exception:
                logger.exception("failed to delete expired audio recording chunk: path=%s", path)

    def _parse_chunk_timestamp(self, path: Path) -> int | None:
        name = path.stem
        prefix = "audio-"

        if not name.startswith(prefix):
            return None

        try:
            return int(name[len(prefix):])
        except ValueError:
            return None


async def serve_audio_recorder() -> None:
    recorder = WavAudioRecorder()
    await recorder.run()
