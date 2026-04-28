#!/bin/bash
# =============================================================================
#  LiveGine — Multi-Domain Production Installer (Stage 1)
#  Usage: sudo bash deploy/install-livegine.sh
#  Tested on: Ubuntu 22.04 / 24.04
#  Re-runnable: yes (idempotent)
#
#  DOES NOT modify:
#    - install-full-saas.sh (the STABLE_GOLD installer)
#    - install-saas.sh
#    - game engine, session logic, frontend business logic, billing, TikTok
#
#  Creates a multi-vhost deployment for:
#    - livegine.com / www.livegine.com  (landing page)
#    - app.livegine.com                 (SaaS dashboard + overlay + WS)
#    - admin.livegine.com               (admin panel placeholder)
#    - api.livegine.com                 (503 stub, optional)
# =============================================================================
set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()      { echo -e "  ${GREEN}✔${NC}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $*"; }
fail()    { echo -e "\n  ${RED}✖  ERROR:${NC} $*\n" >&2; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}━━━  $*  ━━━${NC}"; }
info()    { echo -e "  ${CYAN}→${NC}  $*"; }

# ── Rollback tracking ────────────────────────────────────────────────────────
ROLLBACK_FILES=()
ROLLBACK_DIRS=()
ROLLBACK_SYMLINKS=()
ROLLBACK_TRIGGERED=false

rollback_register_file()    { ROLLBACK_FILES+=("$1"); }
rollback_register_dir()     { ROLLBACK_DIRS+=("$1"); }
rollback_register_symlink() { ROLLBACK_SYMLINKS+=("$1"); }

rollback() {
    if "$ROLLBACK_TRIGGERED"; then return; fi
    ROLLBACK_TRIGGERED=true
    echo ""
    echo -e "  ${RED}${BOLD}Rolling back partial installation...${NC}"
    for f in "${ROLLBACK_SYMLINKS[@]:-}"; do
        [ -n "$f" ] && [ -L "$f" ] && rm -f "$f" && echo "  removed symlink: $f"
    done
    for f in "${ROLLBACK_FILES[@]:-}"; do
        [ -n "$f" ] && [ -f "$f" ] && rm -f "$f" && echo "  removed file: $f"
    done
    for d in "${ROLLBACK_DIRS[@]:-}"; do
        [ -n "$d" ] && [ -d "$d" ] && rmdir "$d" 2>/dev/null && echo "  removed dir: $d"
    done
    # Restore nginx to last known good state
    if nginx -t &>/dev/null; then
        systemctl reload nginx 2>/dev/null || true
    fi
    echo -e "  ${RED}Rollback complete. Fix the issue and re-run the installer.${NC}"
}

trap 'if [ $? -ne 0 ]; then rollback; fi' EXIT

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         LiveGine — Multi-Domain Production Installer         ║"
echo "║                     VPS Full Setup                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  This script installs the LiveGine multi-domain deployment:"
echo "    - Landing page   (livegine.com + www)"
echo "    - App dashboard  (app.livegine.com)"
echo "    - Admin panel    (admin.livegine.com)"
echo "    - API stub       (api.livegine.com, optional)"
echo ""
echo "  The existing install-full-saas.sh installer is NOT modified."
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    fail "Please run as root: sudo bash deploy/install-livegine.sh"
fi

if ! command -v apt-get &>/dev/null; then
    fail "This installer requires apt-get (Ubuntu/Debian)."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_SRC="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ ! -f "${PROJECT_SRC}/requirements.txt" ]; then
    fail "requirements.txt not found. Run from the project root."
fi

# =============================================================================
#  SECTION 0 — Interactive configuration
# =============================================================================
section "Configuration"
echo "  Answer the following. Press ENTER to accept [defaults]."
echo ""

ask() {
    local prompt="$1" default="${2:-}" var_name="$3" value=""
    while true; do
        if [ -n "$default" ]; then
            echo -n "  ${prompt} [${default}]: "
        else
            echo -n "  ${prompt}: "
        fi
        read -r value
        [ -z "$value" ] && [ -n "$default" ] && value="$default"
        [ -n "$value" ] && break
        echo "  ${RED}This field is required.${NC}"
    done
    printf -v "$var_name" '%s' "$value"
}

ask_optional() {
    local prompt="$1" default="${2:-}" var_name="$3" value=""
    if [ -n "$default" ]; then
        echo -n "  ${prompt} [${default}]: "
    else
        echo -n "  ${prompt} (leave blank to skip): "
    fi
    read -r value
    [ -z "$value" ] && value="$default"
    printf -v "$var_name" '%s' "$value"
}

echo -e "  ${BOLD}Domain configuration:${NC}"
ask       "Landing domain (e.g. livegine.com)"           ""                   LANDING_DOMAIN
ask       "App domain (e.g. app.livegine.com)"           "app.${LANDING_DOMAIN}" APP_DOMAIN
ask       "Admin domain (e.g. admin.livegine.com)"       "admin.${LANDING_DOMAIN}" ADMIN_DOMAIN
ask_optional "API domain (e.g. api.livegine.com)"        "api.${LANDING_DOMAIN}" API_DOMAIN

echo ""
echo -e "  ${BOLD}Server configuration:${NC}"
ask       "SSL certificate email"                        ""                   SSL_EMAIL
ask       "Git branch to deploy"                         "main"               GIT_BRANCH
ask       "PostgreSQL database name"                     "livegine"           DB_NAME
ask       "PostgreSQL database user"                     "livegine"           DB_USER

echo -n "  PostgreSQL database password (leave blank to auto-generate): "
read -rs DB_PASS_INPUT
echo ""
if [ -z "$DB_PASS_INPUT" ]; then
    DB_PASS="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
    info "Auto-generated database password"
else
    DB_PASS="$DB_PASS_INPUT"
fi

ask       "Application install directory"  "/opt/livegine"      APP_DIR
ask       "systemd service name"           "livegine"           SERVICE_NAME

echo ""
echo -e "  ${BOLD}Summary:${NC}"
echo "  ─────────────────────────────────────────────────"
echo "  Landing domain : ${LANDING_DOMAIN} (+ www.${LANDING_DOMAIN})"
echo "  App domain     : ${APP_DOMAIN}"
echo "  Admin domain   : ${ADMIN_DOMAIN}"
echo "  API domain     : ${API_DOMAIN:-[skipped]}"
echo "  SSL email      : ${SSL_EMAIL}"
echo "  Git branch     : ${GIT_BRANCH}"
echo "  Database       : ${DB_NAME} / ${DB_USER}"
echo "  Install dir    : ${APP_DIR}"
echo "  Service name   : ${SERVICE_NAME}"
echo "  ─────────────────────────────────────────────────"
echo ""
echo -n "  Proceed? [Y/n]: "
read -r CONFIRM
CONFIRM="${CONFIRM:-y}"
[[ ! "$CONFIRM" =~ ^[Yy]$ ]] && { echo "  Cancelled."; exit 0; }

# ── Derived constants ─────────────────────────────────────────────────────────
LOG_DIR="/var/log/${SERVICE_NAME}"
ENV_DIR="/etc/${SERVICE_NAME}"
ENV_FILE="${ENV_DIR}/saas.env"
VENV="${APP_DIR}/venv"
GUNICORN_BIND="127.0.0.1:5001"
HEALTH_URL="http://${GUNICORN_BIND}/api/health"
LANDING_ROOT="${APP_DIR}/landing"
ADMIN_ROOT="${APP_DIR}/admin-static"

# =============================================================================
#  SECTION 1 — DNS validation
# =============================================================================
section "1 / 15 — DNS validation"

check_dns() {
    local domain="$1" label="$2"
    local server_ip
    server_ip="$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

    info "Checking ${label}: ${domain}..."
    local resolved
    resolved="$(dig +short "${domain}" A 2>/dev/null | head -1)"

    if [ -z "$resolved" ]; then
        warn "DNS not resolving for ${domain} — Certbot will fail for this domain."
        warn "Add an A record: ${domain} -> ${server_ip}"
        return 1
    elif [ "$resolved" = "$server_ip" ]; then
        ok "${domain} -> ${resolved} (matches this server)"
        return 0
    else
        warn "${domain} -> ${resolved} (this server: ${server_ip}) — mismatch!"
        warn "Certbot may fail. Verify your DNS records."
        return 1
    fi
}

DNS_OK=true
check_dns "${LANDING_DOMAIN}"       "landing"       || DNS_OK=false
check_dns "www.${LANDING_DOMAIN}"   "landing (www)" || DNS_OK=false
check_dns "${APP_DOMAIN}"           "app"           || DNS_OK=false
check_dns "${ADMIN_DOMAIN}"         "admin"         || DNS_OK=false
if [ -n "${API_DOMAIN}" ]; then
    check_dns "${API_DOMAIN}"       "api"           || DNS_OK=false
fi

if ! "$DNS_OK"; then
    echo ""
    warn "One or more DNS records are not resolving correctly."
    echo -n "  Continue anyway? SSL will be skipped for failed domains. [y/N]: "
    read -r DNS_CONTINUE
    DNS_CONTINUE="${DNS_CONTINUE:-n}"
    [[ ! "$DNS_CONTINUE" =~ ^[Yy]$ ]] && { echo "  Fix DNS and re-run."; exit 0; }
fi

# =============================================================================
#  SECTION 2 — System packages
# =============================================================================
section "2 / 15 — System packages"

info "Running apt-get update..."
apt-get update -qq

PKGS=(
    git curl wget gnupg2 lsb-release ca-certificates dnsutils
    nginx
    certbot python3-certbot-nginx
    python3 python3-venv python3-pip python3-dev
    postgresql postgresql-contrib
    build-essential libpq-dev
    rsync openssl
)

info "Installing packages..."
apt-get install -y -qq "${PKGS[@]}"
ok "System packages installed"

# =============================================================================
#  SECTION 3 — Node.js LTS
# =============================================================================
section "3 / 15 — Node.js LTS"

if command -v node &>/dev/null && node --version | grep -qE '^v(18|20|22)\.'; then
    ok "Node.js $(node --version) already present"
else
    info "Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
fi

command -v node &>/dev/null || fail "node not found"
command -v npm  &>/dev/null || fail "npm not found"
ok "Node.js $(node -v) | npm $(npm -v)"

# =============================================================================
#  SECTION 4 — Clone or update the repository
# =============================================================================
section "4 / 15 — Project files"

GIT_REMOTE=""
[ -d "${PROJECT_SRC}/.git" ] && GIT_REMOTE="$(git -C "${PROJECT_SRC}" remote get-url origin 2>/dev/null || true)"

if [ -d "${APP_DIR}/.git" ]; then
    info "Repository exists at ${APP_DIR}. Updating..."
    git -C "${APP_DIR}" fetch origin
    git -C "${APP_DIR}" checkout "${GIT_BRANCH}"
    git -C "${APP_DIR}" pull origin "${GIT_BRANCH}"
    ok "Updated to branch '${GIT_BRANCH}'"
elif [ -n "${GIT_REMOTE}" ]; then
    info "Cloning ${GIT_REMOTE}..."
    mkdir -p "$(dirname "${APP_DIR}")"
    git clone --branch "${GIT_BRANCH}" "${GIT_REMOTE}" "${APP_DIR}"
    ok "Repository cloned"
else
    info "Syncing from local source..."
    mkdir -p "${APP_DIR}"
    rsync -a \
        --exclude='venv/' --exclude='node_modules/' --exclude='.git/' \
        --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='dist/' --exclude='data/*.db' --exclude='tmp/' \
        "${PROJECT_SRC}/" "${APP_DIR}/"
    ok "Project files synced to ${APP_DIR}"
fi

# =============================================================================
#  SECTION 5 — Python virtual environment
# =============================================================================
section "5 / 15 — Python environment"

[ ! -d "${VENV}" ] && python3 -m venv "${VENV}"
"${VENV}/bin/pip" install --upgrade pip -q
"${VENV}/bin/pip" install -r "${APP_DIR}/requirements.txt" -q
ok "Python dependencies installed"

# =============================================================================
#  SECTION 6 — PostgreSQL setup
# =============================================================================
section "6 / 15 — PostgreSQL"

systemctl enable postgresql --quiet
systemctl start postgresql
ok "PostgreSQL running"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
            PASSWORD '${DB_PASS}';
    ELSE
        ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';
    END IF;
END
\$\$;
SQL
ok "Database user '${DB_USER}' ready"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}')
\gexec
SQL
ok "Database '${DB_NAME}' ready"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<SQL
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT USAGE  ON SCHEMA public TO ${DB_USER};
GRANT CREATE ON SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${DB_USER};
SQL
ok "Privileges granted"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

# =============================================================================
#  SECTION 7 — Environment file
# =============================================================================
section "7 / 15 — Environment file"

mkdir -p "${ENV_DIR}"
chown root:www-data "${ENV_DIR}"
chmod 750 "${ENV_DIR}"

JWT_SECRET="$(openssl rand -hex 32)"

cat > "${ENV_FILE}" <<EOF
# LiveGine — Production environment
# Generated by install-livegine.sh on $(date -u '+%Y-%m-%d %H:%M UTC')

DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_HOURS=168
BCRYPT_ROUNDS=12

SAAS_PORT=5001
APP_BASE_URL=https://${APP_DOMAIN}
SAAS_BASE_URL=https://${APP_DOMAIN}
CORS_ORIGINS=https://${APP_DOMAIN},https://${LANDING_DOMAIN},https://${ADMIN_DOMAIN}

FLASK_ENV=production
FLASK_DEBUG=0
PYTHONUNBUFFERED=1
PYTHONPATH=${APP_DIR}

STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
STRIPE_PRICE_PREMIUM=
EOF

chown root:www-data "${ENV_FILE}"
chmod 640 "${ENV_FILE}"
ok "Environment file: ${ENV_FILE}"

# =============================================================================
#  SECTION 8 — Frontend build
# =============================================================================
section "8 / 15 — Frontend build"

cd "${APP_DIR}"
npm ci --silent 2>/dev/null || npm install --silent

cat > "${APP_DIR}/.env.production" <<EOF
VITE_SAAS_API_URL=https://${APP_DOMAIN}
EOF

npm run build || fail "Frontend build failed."
[ -f "${APP_DIR}/dist/index.html" ] || fail "Build produced no dist/index.html."
ok "Frontend built -> ${APP_DIR}/dist/"

# =============================================================================
#  SECTION 9 — Static root placeholders
# =============================================================================
section "9 / 15 — Static placeholders"

# Landing page placeholder
mkdir -p "${LANDING_ROOT}"
if [ ! -f "${LANDING_ROOT}/index.html" ]; then
    cat > "${LANDING_ROOT}/index.html" <<'LANDING_HTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LiveGine — Interactive Live Experiences</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;
       align-items:center;justify-content:center;text-align:center}
  .wrap{max-width:480px;padding:2rem}
  h1{font-size:2.5rem;font-weight:700;margin-bottom:.75rem;
     background:linear-gradient(135deg,#00b4d8,#0077b6);
     -webkit-background-clip:text;-webkit-text-fill-color:transparent}
  p{font-size:1.1rem;line-height:1.6;color:#999;margin-bottom:1.5rem}
  a{color:#00b4d8;text-decoration:none;font-weight:600;
    border:1px solid #00b4d8;padding:.6rem 1.5rem;border-radius:6px;
    transition:all .2s}
  a:hover{background:#00b4d8;color:#0a0a0a}
</style>
</head>
<body>
<div class="wrap">
  <h1>LiveGine</h1>
  <p>Interactive live quiz experiences for your audience. Engage, entertain, compete — in real time.</p>
  <a href="https://app.livegine.com">Open Dashboard</a>
</div>
</body>
</html>
LANDING_HTML
    ok "Landing placeholder created: ${LANDING_ROOT}/index.html"
else
    ok "Landing page already exists (preserved)"
fi

# Admin panel placeholder
mkdir -p "${ADMIN_ROOT}"
if [ ! -f "${ADMIN_ROOT}/index.html" ]; then
    cat > "${ADMIN_ROOT}/index.html" <<'ADMIN_HTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LiveGine Admin</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#111;color:#ccc;min-height:100vh;display:flex;
       align-items:center;justify-content:center;text-align:center}
  .wrap{max-width:420px;padding:2rem}
  h1{font-size:2rem;font-weight:700;margin-bottom:.5rem;color:#e0e0e0}
  p{font-size:1rem;line-height:1.6;color:#888}
  .badge{display:inline-block;margin-top:1rem;padding:.4rem 1rem;
         border:1px solid #444;border-radius:4px;font-size:.85rem;color:#666}
</style>
</head>
<body>
<div class="wrap">
  <h1>LiveGine Admin</h1>
  <p>The admin panel is not yet deployed on this domain.</p>
  <span class="badge">Coming soon</span>
</div>
</body>
</html>
ADMIN_HTML
    ok "Admin placeholder created: ${ADMIN_ROOT}/index.html"
else
    ok "Admin page already exists (preserved)"
fi

# =============================================================================
#  SECTION 10 — Gunicorn configuration
# =============================================================================
section "10 / 15 — Gunicorn"

mkdir -p "${LOG_DIR}"
touch "${LOG_DIR}/saas-access.log" "${LOG_DIR}/saas-error.log"
chown -R www-data:www-data "${LOG_DIR}"
chmod 755 "${LOG_DIR}"

mkdir -p /tmp/gunicorn
chown www-data:www-data /tmp/gunicorn

cat > "${APP_DIR}/deploy/gunicorn.conf.py" <<EOF
workers = 1
worker_class = "gthread"
threads = 8
timeout = 120
keepalive = 5
graceful_timeout = 30
bind = "${GUNICORN_BIND}"
worker_tmp_dir = "/tmp/gunicorn"
accesslog = "${LOG_DIR}/saas-access.log"
errorlog  = "${LOG_DIR}/saas-error.log"
loglevel  = "info"
EOF

ok "Gunicorn config written"

# =============================================================================
#  SECTION 11 — Database bootstrap
# =============================================================================
section "11 / 15 — Database schema"

set +e
"${VENV}/bin/python3" -c "
import sys, os
sys.path.insert(0, '${APP_DIR}')
os.environ.setdefault('DATABASE_URL', '${DATABASE_URL}')
from backend.saas.db.bootstrap import run_bootstrap
run_bootstrap()
"
BOOTSTRAP_EXIT=$?
set -e

[ $BOOTSTRAP_EXIT -eq 0 ] && ok "Schema created / verified" \
    || warn "Bootstrap reported an error — retry after service start."

# =============================================================================
#  SECTION 12 — systemd service
# =============================================================================
section "12 / 15 — systemd service"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
rollback_register_file "${SERVICE_FILE}"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=LiveGine SaaS Backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${APP_DIR}
ExecStartPre=/bin/mkdir -p /tmp/gunicorn
ExecStart=${VENV}/bin/gunicorn \\
    --config ${APP_DIR}/deploy/gunicorn.conf.py \\
    "backend.saas.wsgi:app"
EnvironmentFile=-${ENV_FILE}
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=${APP_DIR}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" --quiet
ok "Service: ${SERVICE_FILE}"

# =============================================================================
#  SECTION 13 — Nginx multi-vhost configuration
# =============================================================================
section "13 / 15 — Nginx (multi-vhost)"

NGINX_PREFIX="livegine"

# Helper: generate a vhost from a template
gen_vhost() {
    local template="$1" output_name="$2"
    shift 2
    local conf="/etc/nginx/sites-available/${output_name}"
    local link="/etc/nginx/sites-enabled/${output_name}"

    cp "${APP_DIR}/deploy/${template}" "${conf}"

    # Apply all placeholder replacements passed as KEY=VALUE pairs
    while [ $# -gt 0 ]; do
        local placeholder="${1%%=*}"
        local value="${1#*=}"
        sed -i "s|{{${placeholder}}}|${value}|g" "${conf}"
        shift
    done

    ln -sf "${conf}" "${link}"
    rollback_register_file "${conf}"
    rollback_register_symlink "${link}"
    ok "${output_name} -> ${conf}"
}

# --- Landing ---
gen_vhost "nginx-landing.conf.template" "${NGINX_PREFIX}-landing" \
    "LANDING_DOMAIN=${LANDING_DOMAIN}" \
    "LANDING_ROOT=${LANDING_ROOT}"

# --- App (full SaaS) ---
gen_vhost "nginx-app.conf.template" "${NGINX_PREFIX}-app" \
    "APP_DOMAIN=${APP_DOMAIN}" \
    "APP_DIR=${APP_DIR}" \
    "GUNICORN_BIND=${GUNICORN_BIND}"

# --- Admin ---
gen_vhost "nginx-admin.conf.template" "${NGINX_PREFIX}-admin" \
    "ADMIN_DOMAIN=${ADMIN_DOMAIN}" \
    "ADMIN_ROOT=${ADMIN_ROOT}"

# --- API (optional) ---
if [ -n "${API_DOMAIN}" ]; then
    gen_vhost "nginx-api.conf.template" "${NGINX_PREFIX}-api" \
        "API_DOMAIN=${API_DOMAIN}"
fi

# Remove default site if present
[ -f "/etc/nginx/sites-enabled/default" ] && rm -f "/etc/nginx/sites-enabled/default"

info "Testing Nginx configuration..."
nginx -t || fail "Nginx config test failed. Check output above."
ok "Nginx config valid (all vhosts)"

# =============================================================================
#  SECTION 14 — Permissions and start
# =============================================================================
section "14 / 15 — Permissions and service start"

chown -R www-data:www-data "${APP_DIR}" "${LOG_DIR}"
chmod -R o-rwx "${APP_DIR}"
ok "Permissions set"

info "Reloading Nginx..."
systemctl reload nginx
ok "Nginx reloaded"

info "Starting ${SERVICE_NAME}..."
systemctl restart "${SERVICE_NAME}"
sleep 10

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    ok "Service ${SERVICE_NAME} is active"
else
    warn "Service not active — checking logs..."
    journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
fi

# =============================================================================
#  SECTION 15 — SSL with Certbot (per domain)
# =============================================================================
section "15 / 15 — SSL / Certbot (per domain)"

SSL_RESULTS=()

obtain_cert() {
    local domain="$1" label="$2" extra_domains="${3:-}"
    info "Requesting certificate for ${label} (${domain})..."

    local certbot_args=(
        --nginx --non-interactive --agree-tos
        --email "${SSL_EMAIL}" --redirect
        -d "${domain}"
    )
    [ -n "$extra_domains" ] && certbot_args+=(-d "$extra_domains")

    set +e
    certbot "${certbot_args[@]}" 2>&1
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
        ok "SSL: ${domain} — certificate obtained"
        SSL_RESULTS+=("${label}: OK")
    else
        warn "SSL: ${domain} — Certbot failed (exit ${exit_code})"
        warn "  Run manually: sudo certbot --nginx -d ${domain} --email ${SSL_EMAIL}"
        SSL_RESULTS+=("${label}: FAILED")
    fi
}

obtain_cert "${LANDING_DOMAIN}" "landing" "www.${LANDING_DOMAIN}"
obtain_cert "${APP_DOMAIN}"     "app"
obtain_cert "${ADMIN_DOMAIN}"   "admin"
[ -n "${API_DOMAIN}" ] && obtain_cert "${API_DOMAIN}" "api"

# Inject HSTS into SSL blocks
info "Adding HSTS headers..."
for conf_file in /etc/nginx/sites-available/${NGINX_PREFIX}-*; do
    [ -f "$conf_file" ] || continue
    python3 - "${conf_file}" <<'PYEOF'
import sys, re
path = sys.argv[1]
with open(path) as f:
    content = f.read()
hsts = '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n'
def inject(m):
    block = m.group(0)
    if 'ssl' not in block[:200]:
        return block
    if 'Strict-Transport-Security' in block:
        return block
    return re.sub(r'([ \t]*server_name[^\n]+\n)', r'\1' + hsts, block, count=1)
result = re.sub(r'server\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}', inject, content, flags=re.DOTALL)
with open(path, 'w') as f:
    f.write(result)
PYEOF
done
nginx -t && systemctl reload nginx || true
ok "HSTS applied"

# =============================================================================
#  Final health check
# =============================================================================
section "Final verification"

systemctl is-active --quiet "${SERVICE_NAME}" \
    && ok "Service: ACTIVE" \
    || warn "Service: INACTIVE"

systemctl is-active --quiet nginx \
    && ok "Nginx: ACTIVE" \
    || warn "Nginx: INACTIVE"

info "Health check against ${HEALTH_URL}..."
HEALTH_PASS=false
for attempt in 1 2 3 4 5 6; do
    if curl -sf --max-time 8 "${HEALTH_URL}" >/dev/null 2>&1; then
        HEALTH_PASS=true
        ok "Health check passed (attempt ${attempt})"
        break
    fi
    [ "$attempt" -lt 6 ] && sleep 5
done
if ! "$HEALTH_PASS"; then
    journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
    fail "Health check failed after 6 attempts."
fi

# =============================================================================
#  Summary
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              LiveGine Installation Complete                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}App directory   :${NC} ${APP_DIR}"
echo -e "  ${BOLD}Landing         :${NC} https://${LANDING_DOMAIN}"
echo -e "  ${BOLD}App dashboard   :${NC} https://${APP_DOMAIN}"
echo -e "  ${BOLD}Admin panel     :${NC} https://${ADMIN_DOMAIN}"
[ -n "${API_DOMAIN}" ] && echo -e "  ${BOLD}API stub        :${NC} https://${API_DOMAIN}"
echo -e "  ${BOLD}Service         :${NC} ${SERVICE_NAME}"
echo -e "  ${BOLD}Env file        :${NC} ${ENV_FILE}"
echo -e "  ${BOLD}Log directory   :${NC} ${LOG_DIR}"
echo ""
echo -e "  ${BOLD}SSL results:${NC}"
for r in "${SSL_RESULTS[@]:-}"; do
    echo "    ${r}"
done
echo ""
echo -e "  ${BOLD}Static roots:${NC}"
echo "    Landing : ${LANDING_ROOT}"
echo "    Admin   : ${ADMIN_ROOT}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo "  ─────────────────────────────────────────────────────────────"
echo "  systemctl status ${SERVICE_NAME}"
echo "  journalctl -u ${SERVICE_NAME} -f"
echo "  sudo nano ${ENV_FILE}"
echo "  sudo systemctl restart ${SERVICE_NAME}"
echo ""
echo -e "  ${BOLD}Nginx vhosts:${NC}"
echo "    /etc/nginx/sites-available/${NGINX_PREFIX}-landing"
echo "    /etc/nginx/sites-available/${NGINX_PREFIX}-app"
echo "    /etc/nginx/sites-available/${NGINX_PREFIX}-admin"
[ -n "${API_DOMAIN}" ] && echo "    /etc/nginx/sites-available/${NGINX_PREFIX}-api"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo "  1. Replace landing placeholder with your actual landing page"
echo "  2. Replace admin placeholder with the admin panel build"
echo "  3. Add Stripe keys to ${ENV_FILE}"
echo "  4. Restart: sudo systemctl restart ${SERVICE_NAME}"
echo ""
