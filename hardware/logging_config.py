from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

DEFAULT_ACTION_LOG_PATH = Path(__file__).resolve().parent / "data" / "hardware-actions.log"

_configured = False


class PrettyColorFormatter(logging.Formatter):
    RESET = "\x1b[0m"
    DIM = "\x1b[2m"
    COLORS = {
        logging.DEBUG: "\x1b[36m",
        logging.INFO: "\x1b[32m",
        logging.WARNING: "\x1b[33m",
        logging.ERROR: "\x1b[31m",
        logging.CRITICAL: "\x1b[35;1m",
    }

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, self.datefmt)
        level_color = self.COLORS.get(record.levelno, "")
        level = f"{record.levelname:8}"
        logger_name = record.name
        message = record.getMessage()

        formatted = (
            f"{self.DIM}{timestamp}{self.RESET} "
            f"{level_color}{level}{self.RESET} "
            f"{self.DIM}{logger_name}{self.RESET} "
            f"{message}"
        )

        if record.exc_info:
            formatted = f"{formatted}\n{self.formatException(record.exc_info)}"

        if record.stack_info:
            formatted = f"{formatted}\n{self.formatStack(record.stack_info)}"

        return formatted


def should_use_color(stream: Any) -> bool:
    if os.environ.get("NO_COLOR"):
        return False

    is_a_tty = getattr(stream, "isatty", None)
    return bool(is_a_tty and is_a_tty())


def get_action_log_path() -> Path:
    configured_path = os.environ.get("HARDWARE_ACTION_LOG_PATH")

    if configured_path:
        return Path(configured_path).expanduser()

    return DEFAULT_ACTION_LOG_PATH


def create_file_handler() -> logging.FileHandler:
    action_log_path = get_action_log_path()
    action_log_path.parent.mkdir(parents=True, exist_ok=True)

    handler = logging.FileHandler(action_log_path, encoding="utf-8")
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s.%(msecs)03d %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    return handler


def setup_logging(level: int = logging.INFO) -> None:
    global _configured

    if _configured:
        return

    console_handler = logging.StreamHandler()

    if should_use_color(console_handler.stream):
        console_handler.setFormatter(PrettyColorFormatter())
    else:
        console_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )

    file_handler = create_file_handler()

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(level)
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)
    logging.getLogger("websockets.server").setLevel(logging.WARNING)
    logging.info("hardware action log ready: path=%s", get_action_log_path())

    _configured = True
