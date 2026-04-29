from __future__ import annotations

import contextlib
import importlib
import logging
import threading
import time
from typing import Any

from config import (
    VIDEO_CAPTURE_BUFFER_SIZE,
    VIDEO_CAPTURE_FPS,
    VIDEO_DEVICE_PATH,
    VIDEO_FRAME_HEIGHT,
    VIDEO_FRAME_WIDTH,
    VIDEO_RETRY_SECONDS,
)

logger = logging.getLogger(__name__)
THREAD_JOIN_TIMEOUT_SECONDS = 0.2


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

    def _extract_direct_jpeg(self, frame: Any) -> bytes | None:
        if not hasattr(frame, "tobytes"):
            return None

        frame_bytes = frame.tobytes()
        if len(frame_bytes) < 4:
            return None

        if frame_bytes[:2] != b"\xff\xd8" or frame_bytes[-2:] != b"\xff\xd9":
            return None

        return frame_bytes

    def _extract_mjpeg_frame(self, frame: Any) -> bytes:
        direct_jpeg = self._extract_direct_jpeg(frame)
        if direct_jpeg is not None:
            return direct_jpeg

        raise RuntimeError(
            "camera_mjpeg_passthrough_unavailable:"
            "backend did not return encoded JPEG frames"
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

        self._enable_mjpeg_passthrough(capture)

        self._capture = capture

        actual_fourcc = self._fourcc_to_string(capture.get(self._cv2.CAP_PROP_FOURCC))
        actual_format = capture.get(getattr(self._cv2, "CAP_PROP_FORMAT", self._cv2.CAP_PROP_FOURCC))
        logger.info(
            (
                "camera ready: device=%s requested=%sx%s@%sfps actual=%sx%s@%.2ffps "
                "codec=%s passthrough=enabled format=%s"
            ),
            VIDEO_DEVICE_PATH,
            VIDEO_FRAME_WIDTH,
            VIDEO_FRAME_HEIGHT,
            VIDEO_CAPTURE_FPS,
            int(capture.get(self._cv2.CAP_PROP_FRAME_WIDTH)),
            int(capture.get(self._cv2.CAP_PROP_FRAME_HEIGHT)),
            capture.get(self._cv2.CAP_PROP_FPS),
            actual_fourcc,
            actual_format,
        )
        return True

    def _close_capture(self) -> None:
        capture = self._capture
        self._capture = None

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
            except Exception as exc:
                self.error = str(exc)
                logger.exception("camera capture failed")
                with self._lock:
                    self._latest_frame = None
                    self._last_frame_time_ms = 0
                self._close_capture()
                if "camera_mjpeg_passthrough_unavailable" in self.error:
                    return
                time.sleep(VIDEO_RETRY_SECONDS)
