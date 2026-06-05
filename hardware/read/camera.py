from __future__ import annotations

import contextlib
import importlib
import logging
import threading
import time
from pathlib import Path
from typing import Any, BinaryIO

from config import (
    VIDEO_CAPTURE_BUFFER_SIZE,
    VIDEO_CAPTURE_FPS,
    VIDEO_DEVICE_PATH,
    VIDEO_FRAME_HEIGHT,
    VIDEO_FRAME_WIDTH,
    VIDEO_RECORD_CHUNK_SECONDS,
    VIDEO_RECORD_ENABLED,
    VIDEO_RECORD_FPS,
    VIDEO_RECORD_WINDOW_SECONDS,
    VIDEO_RETRY_SECONDS,
)

logger = logging.getLogger(__name__)
THREAD_JOIN_TIMEOUT_SECONDS = 0.2
JPEG_START_MARKER = b"\xff\xd8"
JPEG_END_MARKER = b"\xff\xd9"


class CameraFrameEncodingError(RuntimeError):
    pass


class MjpegRecorder:
    def __init__(self) -> None:
        self._data_dir = Path(__file__).resolve().parents[1] / "data" / "video"
        self._file_handle: BinaryIO | None = None
        self._chunk_started_ms = 0
        self._last_recorded_ms = 0
        self._record_interval_ms = max(1, int(1000 / max(1, VIDEO_RECORD_FPS)))
        self._chunk_duration_ms = max(1, VIDEO_RECORD_CHUNK_SECONDS * 1000)

    def close(self) -> None:
        if self._file_handle is None:
            return

        with contextlib.suppress(Exception):
            self._file_handle.flush()
            self._file_handle.close()

        self._file_handle = None

    def record_frame(self, frame: bytes, timestamp_ms: int) -> None:
        if not VIDEO_RECORD_ENABLED:
            return

        try:
            self._record_frame(frame, timestamp_ms)
        except Exception:
            logger.exception("failed to record video frame")
            self.close()

    def _record_frame(self, frame: bytes, timestamp_ms: int) -> None:
        if timestamp_ms - self._last_recorded_ms < self._record_interval_ms:
            return

        self._last_recorded_ms = timestamp_ms
        self._ensure_chunk(timestamp_ms)

        if self._file_handle is not None:
            self._file_handle.write(frame)

    def _ensure_chunk(self, timestamp_ms: int) -> None:
        chunk_age_ms = timestamp_ms - self._chunk_started_ms
        if self._file_handle is not None and chunk_age_ms < self._chunk_duration_ms:
            return

        self.close()
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._delete_expired_chunks(timestamp_ms)

        self._chunk_started_ms = timestamp_ms
        path = self._data_dir / f"camera-{timestamp_ms}.mjpg"
        self._file_handle = path.open("ab", buffering=0)
        logger.info("video recording chunk opened: path=%s", path)

    def _delete_expired_chunks(self, now_ms: int) -> None:
        cutoff_ms = now_ms - VIDEO_RECORD_WINDOW_SECONDS * 1000

        for path in self._data_dir.glob("camera-*.mjpg"):
            timestamp_ms = self._parse_chunk_timestamp(path)
            if timestamp_ms is None or timestamp_ms >= cutoff_ms:
                continue

            try:
                path.unlink()
                logger.info("deleted expired video recording chunk: path=%s", path)
            except Exception:
                logger.exception("failed to delete expired video recording chunk: path=%s", path)

    def _parse_chunk_timestamp(self, path: Path) -> int | None:
        name = path.stem
        prefix = "camera-"

        if not name.startswith(prefix):
            return None

        try:
            return int(name[len(prefix):])
        except ValueError:
            return None


class CameraReader:
    def __init__(self) -> None:
        self.available = False
        self.error: str | None = None

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._cv2: Any | None = None
        self._capture: Any | None = None
        self._latest_frame: bytes | None = None
        self._last_frame_time_ms = 0
        self._use_mjpeg_passthrough = True
        self._using_encoded_passthrough = False
        self._logged_decode_fallback = False
        self._recorder = MjpegRecorder()

        try:
            self._cv2 = importlib.import_module("cv2")
            self.available = True
        except Exception as exc:
            self.error = str(exc)
            logger.exception("camera reader initialization failed")

    def start(self) -> None:
        if not self.available:
            return

        if self._thread is not None and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="camera-reader", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=THREAD_JOIN_TIMEOUT_SECONDS)
            self._thread = None

        self._close_capture()
        self._recorder.close()

    def status_payload(self) -> bool:
        with self._lock:
            return self._latest_frame is not None

    def latest_frame(self) -> bytes | None:
        with self._lock:
            return self._latest_frame

    def latest_frame_time_ms(self) -> int:
        with self._lock:
            return self._last_frame_time_ms

    def _fourcc_to_string(self, value: float) -> str:
        try:
            code = int(value)
        except (TypeError, ValueError):
            return "unknown"

        if code <= 0:
            return "unknown"

        return "".join(chr((code >> (8 * offset)) & 0xFF) for offset in range(4))

    def _enable_mjpeg_passthrough(self, capture: Any) -> None:
        convert_rgb_prop = getattr(self._cv2, "CAP_PROP_CONVERT_RGB", None)
        if convert_rgb_prop is not None:
            capture.set(convert_rgb_prop, 0)

        format_prop = getattr(self._cv2, "CAP_PROP_FORMAT", None)
        if format_prop is not None:
            capture.set(format_prop, -1)

    def _enable_decoded_frames(self, capture: Any) -> None:
        convert_rgb_prop = getattr(self._cv2, "CAP_PROP_CONVERT_RGB", None)
        if convert_rgb_prop is not None:
            capture.set(convert_rgb_prop, 1)

    def _describe_frame(self, frame: Any) -> str:
        details = [f"type={type(frame).__name__}"]

        shape = getattr(frame, "shape", None)
        if shape is not None:
            details.append(f"shape={shape}")

        dtype = getattr(frame, "dtype", None)
        if dtype is not None:
            details.append(f"dtype={dtype}")

        if hasattr(frame, "tobytes"):
            try:
                details.append(f"bytes={len(frame.tobytes())}")
            except Exception:
                details.append("bytes=unavailable")

        return " ".join(details)

    def _extract_direct_jpeg(self, frame: Any) -> bytes | None:
        if not hasattr(frame, "tobytes"):
            return None

        frame_bytes = frame.tobytes()
        if len(frame_bytes) < 4:
            return None

        start = frame_bytes.find(JPEG_START_MARKER)
        if start < 0:
            return None

        end = frame_bytes.find(JPEG_END_MARKER, start + len(JPEG_START_MARKER))
        if end < 0:
            return None

        return frame_bytes[start:end + len(JPEG_END_MARKER)]

    def _encode_decoded_frame(self, frame: Any) -> bytes | None:
        if self._cv2 is None or not hasattr(frame, "shape"):
            return None

        if len(frame.shape) < 2:
            return None

        if frame.shape[0] <= 1 or frame.shape[1] <= 1:
            return None

        ok, encoded = self._cv2.imencode(".jpg", frame)
        if not ok or not hasattr(encoded, "tobytes"):
            return None

        if not self._logged_decode_fallback:
            logger.warning("camera frames are being JPEG-encoded in software")
            self._logged_decode_fallback = True

        return encoded.tobytes()

    def _extract_mjpeg_frame(self, frame: Any) -> bytes:
        if self._use_mjpeg_passthrough:
            direct_jpeg = self._extract_direct_jpeg(frame)
            if direct_jpeg is not None:
                self._using_encoded_passthrough = True
                return direct_jpeg

        encoded_frame = self._encode_decoded_frame(frame)
        if encoded_frame is not None:
            self._using_encoded_passthrough = False
            return encoded_frame

        raise CameraFrameEncodingError(
            "camera_frame_encoding_failed:"
            "backend returned neither JPEG bytes nor an encodable frame "
            f"({self._describe_frame(frame)})"
        )

    def _open_capture(self) -> bool:
        if self._cv2 is None:
            return False

        backend = getattr(self._cv2, "CAP_V4L2", 0)
        capture = self._cv2.VideoCapture(VIDEO_DEVICE_PATH, backend)
        if not capture.isOpened():
            capture.release()
            capture = self._cv2.VideoCapture(VIDEO_DEVICE_PATH)

        if not capture.isOpened():
            self.error = f"unable_to_open:{VIDEO_DEVICE_PATH}"
            return False

        mjpg_fourcc = self._cv2.VideoWriter_fourcc(*"MJPG")
        capture.set(self._cv2.CAP_PROP_FOURCC, mjpg_fourcc)
        capture.set(self._cv2.CAP_PROP_FRAME_WIDTH, VIDEO_FRAME_WIDTH)
        capture.set(self._cv2.CAP_PROP_FRAME_HEIGHT, VIDEO_FRAME_HEIGHT)
        capture.set(self._cv2.CAP_PROP_FPS, VIDEO_CAPTURE_FPS)

        buffer_size_prop = getattr(self._cv2, "CAP_PROP_BUFFERSIZE", None)
        if buffer_size_prop is not None:
            capture.set(buffer_size_prop, VIDEO_CAPTURE_BUFFER_SIZE)

        if self._use_mjpeg_passthrough:
            self._enable_mjpeg_passthrough(capture)
            passthrough_mode = "requested"
        else:
            self._enable_decoded_frames(capture)
            passthrough_mode = "disabled"

        self._capture = capture
        self._logged_decode_fallback = False

        actual_fourcc = self._fourcc_to_string(capture.get(self._cv2.CAP_PROP_FOURCC))
        actual_format = capture.get(getattr(self._cv2, "CAP_PROP_FORMAT", self._cv2.CAP_PROP_FOURCC))
        logger.info(
            (
                "camera ready: device=%s requested=%sx%s@%sfps actual=%sx%s@%.2ffps "
                "codec=%s passthrough=%s format=%s"
            ),
            VIDEO_DEVICE_PATH,
            VIDEO_FRAME_WIDTH,
            VIDEO_FRAME_HEIGHT,
            VIDEO_CAPTURE_FPS,
            int(capture.get(self._cv2.CAP_PROP_FRAME_WIDTH)),
            int(capture.get(self._cv2.CAP_PROP_FRAME_HEIGHT)),
            capture.get(self._cv2.CAP_PROP_FPS),
            actual_fourcc,
            passthrough_mode,
            actual_format,
        )
        return True

    def _close_capture(self) -> None:
        capture = self._capture
        self._capture = None
        self._using_encoded_passthrough = False

        if capture is not None:
            with contextlib.suppress(Exception):
                capture.release()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            if self._capture is None and not self._open_capture():
                with self._lock:
                    self._latest_frame = None
                    self._last_frame_time_ms = 0
                time.sleep(VIDEO_RETRY_SECONDS)
                continue

            try:
                ok, frame = self._capture.read()
                if not ok:
                    raise RuntimeError("camera_read_failed")

                encoded = self._extract_mjpeg_frame(frame)

                now_ms = int(time.time() * 1000)
                with self._lock:
                    self._latest_frame = encoded
                    self._last_frame_time_ms = now_ms
                self.error = None
                self._recorder.record_frame(encoded, now_ms)
            except CameraFrameEncodingError as exc:
                self.error = str(exc)
                if self._use_mjpeg_passthrough:
                    logger.warning(
                        (
                            "camera MJPEG passthrough failed; reopening with "
                            "software JPEG encoding: %s"
                        ),
                        exc,
                    )
                    self._use_mjpeg_passthrough = False
                    self._close_capture()
                    continue

                logger.exception("camera capture failed")
                with self._lock:
                    self._latest_frame = None
                    self._last_frame_time_ms = 0
                self._close_capture()
                time.sleep(VIDEO_RETRY_SECONDS)
            except Exception as exc:
                self.error = str(exc)
                logger.exception("camera capture failed")
                with self._lock:
                    self._latest_frame = None
                    self._last_frame_time_ms = 0
                self._close_capture()
                time.sleep(VIDEO_RETRY_SECONDS)
