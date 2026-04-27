from backend.saas.startup_check import run_startup_checks
from backend.saas.app import create_app
from backend.saas.services.session_manager import session_manager

run_startup_checks()
session_manager.run_startup()
app = create_app()
