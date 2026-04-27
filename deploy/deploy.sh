#!/bin/bash
# Graceful zero-interruption deployment for TikTok Quiz SaaS
# Usage: sudo bash deploy/deploy.sh [BRANCH]
# Example: sudo bash deploy/deploy.sh main

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BRANCH="${1:-main}"
SERVICE="tiktok-quiz-saas"
APP_DIR="/opt/tiktok-quiz"
VENV="${APP_DIR}/venv"
SAAS_PORT="${SAAS_PORT:-5001}"
HEALTH_URL="http://127.0.0.1:${SAAS_PORT}/api/health"
DRAIN_WAIT=35
MAX_STOP_WAIT=60
ROLLBACK_COMMIT=""

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
section() { echo -e "\n${BOLD}── $* ──${NC}"; }

# ── Rollback ──────────────────────────────────────────────────────────────────
rollback() {
    error "Deployment failed. Initiating rollback to ${ROLLBACK_COMMIT}..."
    if [ -n "$ROLLBACK_COMMIT" ]; then
        cd "$APP_DIR"
        git checkout "$ROLLBACK_COMMIT" -- . || error "git rollback failed"
        "${VENV}/bin/pip" install -q -r requirements.txt || true
        npm ci --silent && npm run build || true
        systemctl restart "$SERVICE" || true
        sleep 5
        if health_check; then
            warn "Rollback succeeded. Previous version is live."
        else
            error "Rollback health check also failed. Manual intervention required."
            error "Check: journalctl -u ${SERVICE} -n 100"
        fi
    else
        error "No rollback commit recorded. Restart manually: systemctl start ${SERVICE}"
    fi
    exit 1
}

# ── Health check ──────────────────────────────────────────────────────────────
health_check() {
    local attempts=0
    local max_attempts=6
    while [ $attempts -lt $max_attempts ]; do
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
        if [ "$HTTP_CODE" = "200" ]; then
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 5
    done
    return 1
}

# ── Preflight ─────────────────────────────────────────────────────────────────
section "Preflight checks"

if [ "$EUID" -ne 0 ]; then
    error "Must run as root (sudo)."
    exit 1
fi

if ! systemctl list-unit-files --quiet "${SERVICE}.service" 2>/dev/null | grep -q "$SERVICE"; then
    error "Service ${SERVICE} not found. Check installation."
    exit 1
fi

if ! command -v git &>/dev/null; then
    error "git not found."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    error "npm not found."
    exit 1
fi

ok "All preflight checks passed"

# ── Record rollback point ─────────────────────────────────────────────────────
section "Recording rollback point"
cd "$APP_DIR"
ROLLBACK_COMMIT=$(git rev-parse HEAD)
ok "Rollback commit: ${ROLLBACK_COMMIT}"

# ── Pre-deploy health check ───────────────────────────────────────────────────
section "Pre-deploy health check"
if health_check; then
    ok "Service is healthy before deploy"
else
    warn "Service not responding before deploy — continuing anyway"
fi

# ── Graceful shutdown ─────────────────────────────────────────────────────────
section "Graceful shutdown (SIGTERM)"

PID=$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo "0")

if systemctl is-active --quiet "$SERVICE"; then
    info "Sending SIGTERM to ${SERVICE} (PID: ${PID})..."
    systemctl kill --signal=SIGTERM "$SERVICE"
    info "Waiting ${DRAIN_WAIT}s for active sessions to drain..."
    sleep "$DRAIN_WAIT"
else
    warn "Service was not running. Skipping drain wait."
fi

# ── Verify stopped ────────────────────────────────────────────────────────────
section "Verifying process stopped"

elapsed=0
while systemctl is-active --quiet "$SERVICE" && [ $elapsed -lt $MAX_STOP_WAIT ]; do
    info "Still running, waiting 5s more... (${elapsed}s elapsed)"
    sleep 5
    elapsed=$((elapsed + 5))
done

if systemctl is-active --quiet "$SERVICE"; then
    warn "Service still active after ${MAX_STOP_WAIT}s — sending SIGKILL"
    systemctl kill --signal=SIGKILL "$SERVICE" || true
    sleep 3
    systemctl stop "$SERVICE" || true
fi

ok "Service stopped"

# ── Code update ───────────────────────────────────────────────────────────────
section "Pulling latest code (branch: ${BRANCH})"
cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_COMMIT=$(git rev-parse HEAD)
ok "Updated to commit: ${NEW_COMMIT}"

# ── Python dependencies ───────────────────────────────────────────────────────
section "Installing Python dependencies"
"${VENV}/bin/pip" install -q --upgrade pip
"${VENV}/bin/pip" install -q -r requirements.txt
ok "Python dependencies installed"

# ── Frontend build ────────────────────────────────────────────────────────────
section "Building frontend"
npm ci --silent
npm run build
ok "Frontend built successfully"

# ── Restart service ───────────────────────────────────────────────────────────
section "Starting service"
systemctl daemon-reload
systemctl start "$SERVICE"
info "Waiting for service to initialize..."
sleep 8
ok "Service started"

# ── Post-deploy health check ──────────────────────────────────────────────────
section "Post-deploy health check"
if health_check; then
    ok "Health check passed — deployment successful"
else
    error "Health check failed after deployment"
    rollback
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Deployment complete${NC}"
echo -e "${BOLD}  Branch   :${NC} ${BRANCH}"
echo -e "${BOLD}  Rollback :${NC} ${ROLLBACK_COMMIT}"
echo -e "${BOLD}  Current  :${NC} ${NEW_COMMIT}"
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo ""
