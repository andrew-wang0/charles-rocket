import asyncio

from calibration import load_calibration_set
from .video import serve_video_server
from .websocket import serve_websocket_server


async def main() -> None:
    calibration_set = load_calibration_set()
    await asyncio.gather(
        serve_websocket_server(calibration_set),
        serve_video_server(),
    )


__all__ = ["main"]
