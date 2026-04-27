#!/usr/bin/env python3
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.saas.startup_check import run_startup_checks
from backend.saas.config import settings
from backend.saas.app import create_app
from backend.saas.services.session_manager import session_manager

if __name__ == "__main__":
    run_startup_checks()
    session_manager.run_startup()
    app = create_app()
    print(f"[SaaS] Starting on http://0.0.0.0:{settings.SAAS_PORT}")
    app.run(host="0.0.0.0", port=settings.SAAS_PORT, debug=settings.FLASK_DEBUG)
