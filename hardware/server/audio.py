from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import wave
from pathlib import Path
from typing import BinaryIO

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
AUDIO_STREAM_QUEUE_CHUNKS = 200
AUDIO_READ_INTERVAL_SECONDS = 0.1


class AudioDeviceBusyError(RuntimeError):
    pass


class WavAudioRecorder:
    def __init__(self) -> None:
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "audio"
        self._clients: set[asyncio.Queue[bytes]] = set()
        self._process: asyncio.subprocess.Process | None = None
        self._file_handle: BinaryIO | None = None
        self._wave_writer: wave.Wave_write | None = None
        self._chunk_started_ms = 0
        self._bytes_per_sample = self._sample_width_bytes()
        self._read_size = max(
            self._bytes_per_sample * AUDIO_RECORD_CHANNELS,
            int(
                AUDIO_RECORD_SAMPLE_RATE
                * AUDIO_RECORD_CHANNELS
                * self._bytes_per_sample
                * AUDIO_READ_INTERVAL_SECONDS
            ),
        )

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
            try:
                await self._record_stream()
            except asyncio.CancelledError:
                await self._stop_process()
                self._close_chunk()
                raise
            except FileNotFoundError:
                logger.error("audio recording unavailable: `arecord` command not found")
                await asyncio.sleep(5)
            except AudioDeviceBusyError as exc:
                logger.warning("audio recording skipped because device stayed busy: %s", exc)
                await asyncio.sleep(1)
            except Exception:
                logger.exception("audio recording stream failed")
                await asyncio.sleep(1)

    def subscribe(self) -> asyncio.Queue[bytes]:
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=AUDIO_STREAM_QUEUE_CHUNKS)
        self._clients.add(queue)
        logger.info("audio stream client connected: clients=%s", len(self._clients))
        return queue

    def unsubscribe(self, queue: asyncio.Queue[bytes]) -> None:
        self._clients.discard(queue)
        logger.info("audio stream client disconnected: clients=%s", len(self._clients))

    def wav_header(self) -> bytes:
        byte_rate = AUDIO_RECORD_SAMPLE_RATE * AUDIO_RECORD_CHANNELS * self._bytes_per_sample
        block_align = AUDIO_RECORD_CHANNELS * self._bytes_per_sample
        bits_per_sample = self._bytes_per_sample * 8

        return (
            b"RIFF"
            + (0xFFFFFFFF).to_bytes(4, "little")
            + b"WAVE"
            + b"fmt "
            + (16).to_bytes(4, "little")
            + (1).to_bytes(2, "little")
            + AUDIO_RECORD_CHANNELS.to_bytes(2, "little")
            + AUDIO_RECORD_SAMPLE_RATE.to_bytes(4, "little")
            + byte_rate.to_bytes(4, "little")
            + block_align.to_bytes(2, "little")
            + bits_per_sample.to_bytes(2, "little")
            + b"data"
            + (0xFFFFFFFF).to_bytes(4, "little")
        )

    def _sample_width_bytes(self) -> int:
        if AUDIO_RECORD_SAMPLE_FORMAT != "S16_LE":
            raise ValueError(f"unsupported audio sample format: {AUDIO_RECORD_SAMPLE_FORMAT}")

        return 2

    async def _record_stream(self) -> None:
        for attempt in range(1, AUDIO_DEVICE_BUSY_RETRY_COUNT + 2):
            try:
                await self._record_stream_once()
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

    async def _record_stream_once(self) -> None:
        logger.info("audio recording stream opening: device=%s", AUDIO_RECORD_DEVICE)
        self._process = await asyncio.create_subprocess_exec(
            "arecord",
            "-q",
            "-D",
            AUDIO_RECORD_DEVICE,
            "-f",
            AUDIO_RECORD_SAMPLE_FORMAT,
            "-c",
            str(AUDIO_RECORD_CHANNELS),
            "-r",
            str(AUDIO_RECORD_SAMPLE_RATE),
            "-t",
            "raw",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            assert self._process.stdout is not None
            while True:
                chunk = await self._process.stdout.read(self._read_size)
                if not chunk:
                    break

                timestamp_ms = int(time.time() * 1000)
                self._record_chunk(chunk, timestamp_ms)
                self._broadcast(chunk)
        except asyncio.CancelledError:
            await self._stop_process()
            raise
        finally:
            self._close_chunk()

        process = self._process
        self._process = None
        if process is None:
            return

        returncode = await process.wait()
        stderr = await process.stderr.read() if process.stderr is not None else b""
        if returncode != 0:
            message = stderr.decode("utf-8", errors="replace").strip()

            if self._is_device_busy_message(message):
                raise AudioDeviceBusyError(message)

            raise RuntimeError(f"arecord exited with code {returncode}: {message}")

    def _record_chunk(self, chunk: bytes, timestamp_ms: int) -> None:
        self._ensure_chunk(timestamp_ms)

        if self._wave_writer is not None:
            self._wave_writer.writeframesraw(chunk)

    def _ensure_chunk(self, timestamp_ms: int) -> None:
        chunk_age_ms = timestamp_ms - self._chunk_started_ms
        if self._wave_writer is not None and chunk_age_ms < AUDIO_RECORD_CHUNK_SECONDS * 1000:
            return

        self._close_chunk()
        self._delete_expired_chunks(timestamp_ms)

        self._chunk_started_ms = timestamp_ms
        path = self._data_dir / f"audio-{timestamp_ms}.wav"
        self._file_handle = path.open("wb")
        self._wave_writer = wave.open(self._file_handle, "wb")
        self._wave_writer.setnchannels(AUDIO_RECORD_CHANNELS)
        self._wave_writer.setsampwidth(self._bytes_per_sample)
        self._wave_writer.setframerate(AUDIO_RECORD_SAMPLE_RATE)
        logger.info("audio recording chunk opened: path=%s device=%s", path, AUDIO_RECORD_DEVICE)

    def _close_chunk(self) -> None:
        wave_writer = self._wave_writer
        self._wave_writer = None

        if wave_writer is not None:
            with contextlib.suppress(Exception):
                wave_writer.close()

        self._file_handle = None

    def _broadcast(self, chunk: bytes) -> None:
        stale_clients: list[asyncio.Queue[bytes]] = []

        for queue in self._clients:
            try:
                queue.put_nowait(chunk)
            except asyncio.QueueFull:
                stale_clients.append(queue)

        for queue in stale_clients:
            self.unsubscribe(queue)

    def _is_device_busy_message(self, message: str) -> bool:
        return "Device or resource busy" in message

    async def _stop_process(self) -> None:
        process = self._process
        self._process = None

        if process is None:
            return

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


async def serve_audio_recorder(recorder: WavAudioRecorder | None = None) -> None:
    if recorder is None:
        recorder = WavAudioRecorder()

    await recorder.run()
