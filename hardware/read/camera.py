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
    VIDEO_JPEG_QUALITY,
    VIDEO_RETRY_SECONDS,
)

logger = logging.getLogger(__name__)


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
            self._thread.join(timeout=2)
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

        self._capture = capture
        logger.info(
            "camera ready: device=%s requested=%sx%s@%sfps actual=%sx%s@%.2ffps",
            VIDEO_DEVICE_PATH,
            VIDEO_FRAME_WIDTH,
            VIDEO_FRAME_HEIGHT,
            VIDEO_CAPTURE_FPS,
            int(capture.get(self._cv2.CAP_PROP_FRAME_WIDTH)),
            int(capture.get(self._cv2.CAP_PROP_FRAME_HEIGHT)),
            capture.get(self._cv2.CAP_PROP_FPS),
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

                encoded_ok, encoded = self._cv2.imencode(
                    ".jpg",
                    frame,
                    [int(self._cv2.IMWRITE_JPEG_QUALITY), VIDEO_JPEG_QUALITY],
                )
                if not encoded_ok:
                    raise RuntimeError("camera_encode_failed")

                now_ms = int(time.time() * 1000)
                with self._lock:
                    self._latest_frame = encoded.tobytes()
                    self._last_frame_time_ms = now_ms
            except Exception as exc:
                self.error = str(exc)
                logger.exception("camera capture failed")
                with self._lock:
                    self._latest_frame = None
                    self._last_frame_time_ms = 0
                self._close_capture()
                time.sleep(VIDEO_RETRY_SECONDS)
