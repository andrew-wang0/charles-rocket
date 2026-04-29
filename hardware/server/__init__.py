import asyncio
import contextlib
import logging

from calibration import load_calibration_set
from logging_config import setup_logging
from .video import serve_video_server
from .websocket import serve_websocket_server

logger = logging.getLogger(__name__)


async def run_service(name: str, task: asyncio.Task[None]) -> None:
    try:
        await task
        logger.warning("%s service exited", name)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("%s service crashed", name)


async def main() -> None:
    setup_logging()
    calibration_set = load_calibration_set()
    services = {
        "websocket": asyncio.create_task(serve_websocket_server(calibration_set)),
        "video": asyncio.create_task(serve_video_server()),
    }
    monitor_tasks = {
        asyncio.create_task(run_service(name, task)): name for name, task in services.items()
    }

    try:
        while monitor_tasks:
            done, _ = await asyncio.wait(monitor_tasks, return_when=asyncio.FIRST_COMPLETED)

            for task in done:
                service_name = monitor_tasks.pop(task)
                with contextlib.suppress(Exception):
                    await task

                services.pop(service_name, None)
                if services:
                    logger.warning(
                        "continuing with remaining services: %s",
                        ", ".join(sorted(services)),
                    )
    except asyncio.CancelledError:
        raise
    finally:
        for task in services.values():
            task.cancel()

        await asyncio.gather(*services.values(), return_exceptions=True)

        for task in monitor_tasks:
            task.cancel()

        await asyncio.gather(*monitor_tasks, return_exceptions=True)


__all__ = ["main"]
