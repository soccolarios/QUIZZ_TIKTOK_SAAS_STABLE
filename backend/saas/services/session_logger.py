"""
Per-session in-memory log buffer with optional disk fallback.

Each session gets its own logger and a bounded deque of log entries.
Logs can be retrieved via GET /api/sessions/:id/logs.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Dict, Deque, List

_MAX_ENTRIES = 500

_session_logs: Dict[str, Deque[dict]] = {}
_session_loggers: Dict[str, logging.Logger] = {}


def get_session_buffer(session_id: str) -> Deque[dict]:
    if session_id not in _session_logs:
        _session_logs[session_id] = deque(maxlen=_MAX_ENTRIES)
    return _session_logs[session_id]


def add_log(session_id: str, message: str, level: str = "INFO") -> None:
    buf = get_session_buffer(session_id)
    buf.append({
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "level": level,
        "message": message,
    })
    logger = _get_logger(session_id)
    getattr(logger, level.lower(), logger.info)(message)


def _get_logger(session_id: str) -> logging.Logger:
    if session_id not in _session_loggers:
        logger = logging.getLogger(f"saas.session.{session_id[:8]}")
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter("[%(name)s] %(message)s"))
            logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
        _session_loggers[session_id] = logger
    return _session_loggers[session_id]


def get_logs(session_id: str, limit: int = 200) -> List[dict]:
    buf = get_session_buffer(session_id)
    entries = list(buf)
    return entries[-limit:]


def clear_logs(session_id: str) -> None:
    if session_id in _session_logs:
        _session_logs[session_id].clear()


def make_log_handler(session_id: str):
    def handler(sid: str, message: str):
        add_log(sid, message)
    return lambda msg: handler(session_id, msg)
