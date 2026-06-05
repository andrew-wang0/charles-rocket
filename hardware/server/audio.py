from __future__ import annotations

import asyncio
import contextlib
import logging
import re
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
AUDIO_STREAM_QUEUE_CHUNKS = 20
AUDIO_READ_INTERVAL_SECONDS = 0.02
AUDIO_DEVICE_UNAVAILABLE_RETRY_SECONDS = 5.0
AUDIO_DEVICE_LIST_TIMEOUT_SECONDS = 2.0
AUDIO_AVAILABLE_STALE_SECONDS = 2.0
ARECORD_DEVICE_PATTERN = re.compile(r"card\s+(\d+):.*device\s+(\d+):")


class AudioDeviceBusyError(RuntimeError):
    pass


class AudioDeviceUnavailableError(RuntimeError):
    pass


class WavAudioRecorder:
    def __init__(self) -> None:
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "audio"
        self._clients: set[asyncio.Queue[bytes]] = set()
        self._process: asyncio.subprocess.Process | None = None
        self._file_handle: BinaryIO | None = None
        self._wave_writer: wave.Wave_write | None = None
        self._chunk_started_ms = 0
        self._active_device = AUDIO_RECORD_DEVICE
        self._last_chunk_time = 0.0
        self._last_error: str | None = None
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
                self._last_error = "`arecord` command not found"
                logger.error("audio recording unavailable: %s", self._last_error)
                await asyncio.sleep(5)
            except AudioDeviceBusyError as exc:
                self._last_error = str(exc)
                logger.warning("audio recording skipped because device stayed busy: %s", exc)
                await asyncio.sleep(1)
            except AudioDeviceUnavailableError as exc:
                self._last_error = str(exc)
                logger.warning("audio recording unavailable: %s", exc)
                await asyncio.sleep(AUDIO_DEVICE_UNAVAILABLE_RETRY_SECONDS)
            except Exception:
                self._last_error = "audio recording stream failed"
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

    def status_payload(self) -> dict[str, bool | int | str | None]:
        now = time.monotonic()
        available = (
            self._process is not None
            and self._last_chunk_time > 0
            and now - self._last_chunk_time <= AUDIO_AVAILABLE_STALE_SECONDS
        )

        return {
            "available": available,
            "device": self._active_device if available else None,
            "sampleRate": AUDIO_RECORD_SAMPLE_RATE,
            "channels": AUDIO_RECORD_CHANNELS,
            "sampleFormat": AUDIO_RECORD_SAMPLE_FORMAT,
            "lastError": None if available else self._last_error,
        }

    def _sample_width_bytes(self) -> int:
        if AUDIO_RECORD_SAMPLE_FORMAT != "S16_LE":
            raise ValueError(f"unsupported audio sample format: {AUDIO_RECORD_SAMPLE_FORMAT}")

        return 2

    async def _record_stream(self) -> None:
        unavailable_messages: list[str] = []

        for device in await self._candidate_devices():
            self._active_device = device

            for attempt in range(1, AUDIO_DEVICE_BUSY_RETRY_COUNT + 2):
                try:
                    await self._record_stream_once(device)
                    return
                except AudioDeviceUnavailableError as exc:
                    unavailable_messages.append(str(exc))
                    break
                except AudioDeviceBusyError:
                    if attempt > AUDIO_DEVICE_BUSY_RETRY_COUNT:
                        raise

                    logger.warning(
                        "audio device busy; retrying stream open: attempt=%s/%s delay=%ss device=%s",
                        attempt,
                        AUDIO_DEVICE_BUSY_RETRY_COUNT,
                        AUDIO_DEVICE_BUSY_RETRY_SECONDS,
                        device,
                    )
                    await asyncio.sleep(AUDIO_DEVICE_BUSY_RETRY_SECONDS)

        detail = "; ".join(unavailable_messages) or "no ALSA capture devices found"
        raise AudioDeviceUnavailableError(detail)

    async def _candidate_devices(self) -> list[str]:
        devices = [AUDIO_RECORD_DEVICE]

        for device in await self._list_capture_devices():
            if device not in devices:
                devices.append(device)

        return devices

    async def _list_capture_devices(self) -> list[str]:
        process = await asyncio.create_subprocess_exec(
            "arecord",
            "-l",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, _ = await asyncio.wait_for(
                process.communicate(),
                timeout=AUDIO_DEVICE_LIST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            logger.warning("audio capture device listing timed out")
            return []

        if process.returncode != 0:
            return []

        devices: list[str] = []
        for line in stdout.decode("utf-8", errors="replace").splitlines():
            match = ARECORD_DEVICE_PATTERN.search(line)
            if match is None:
                continue

            card, device = match.groups()
            devices.append(f"plughw:{card},{device}")

        return devices

    async def _record_stream_once(self, device: str) -> None:
        logger.info("audio recording stream opening: device=%s", device)
        self._process = await asyncio.create_subprocess_exec(
            "arecord",
            "-q",
            "-D",
            device,
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
                self._last_chunk_time = time.monotonic()
                self._last_error = None
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

            if self._is_device_unavailable_message(message):
                raise AudioDeviceUnavailableError(f"{device}: {message}")

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
        logger.info("audio recording chunk opened: path=%s device=%s", path, self._active_device)

    def _close_chunk(self) -> None:
        wave_writer = self._wave_writer
        self._wave_writer = None

        if wave_writer is not None:
            with contextlib.suppress(Exception):
                wave_writer.close()

        self._file_handle = None

    def _broadcast(self, chunk: bytes) -> None:
        for queue in self._clients:
            try:
                queue.put_nowait(chunk)
            except asyncio.QueueFull:
                self._drop_queued_audio(queue)
                with contextlib.suppress(asyncio.QueueFull):
                    queue.put_nowait(chunk)

    def _drop_queued_audio(self, queue: asyncio.Queue[bytes]) -> None:
        while not queue.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()

    def _is_device_busy_message(self, message: str) -> bool:
        return "Device or resource busy" in message

    def _is_device_unavailable_message(self, message: str) -> bool:
        return "No such file or directory" in message or "No such device" in message

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
