"""
SessionContext — explicit runtime context for a single SaaS session.

Passed through the SaaS layer to avoid implicit global dependencies.
Every SaasSessionRuntime receives one at construction and uses it for:
  - per-session directory isolation
  - logging with session identity
  - identifying mode (saas vs legacy)

Directory layout:
  tmp/saas_sessions/<session_id>/   — ephemeral (questionnaire JSON, symlink)
                                      cleaned up on stop/restart
  data/saas_sessions/<session_id>/  — persistent (scores.db survives restarts)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

_ENGINE_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../..")
)

_TMP_ROOT = os.path.join(_ENGINE_ROOT, "tmp", "saas_sessions")
_PERSISTENT_ROOT = os.path.join(_ENGINE_ROOT, "data", "saas_sessions")


@dataclass
class SessionContext:
    session_id: str
    user_id: str
    project_id: str
    quiz_id: str
    ws_port: int
    overlay_token: str
    mode: str = "saas"

    runtime_dir: str = field(init=False)
    questionnaire_path: str = field(init=False)
    db_path: str = field(init=False)
    persistent_dir: str = field(init=False)

    def __post_init__(self):
        self.runtime_dir = os.path.join(_TMP_ROOT, self.session_id)
        self.questionnaire_path = os.path.join(
            self.runtime_dir, f"questionnaire_{self.session_id}.json"
        )
        self.persistent_dir = os.path.join(_PERSISTENT_ROOT, self.session_id)
        self.db_path = os.path.join(self.persistent_dir, "scores.db")

    def create_dirs(self) -> None:
        os.makedirs(self.runtime_dir, exist_ok=True)
        os.makedirs(self.persistent_dir, exist_ok=True)

    def cleanup_dirs(self) -> None:
        import shutil
        if os.path.exists(self.runtime_dir):
            try:
                shutil.rmtree(self.runtime_dir)
            except Exception:
                pass

    def log_prefix(self) -> str:
        return f"[session:{self.session_id[:8]}]"
