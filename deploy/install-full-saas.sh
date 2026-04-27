#!/bin/bash
# =============================================================================
#  TikTok Quiz SaaS — Full Production Installer
#  Usage: sudo bash deploy/install-full-saas.sh
#  Tested on: Ubuntu 22.04 / 24.04
#  Re-runnable: yes (idempotent)
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

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          TikTok Quiz SaaS — Production Installer             ║"
echo "║                    VPS Full Setup                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  This script will install everything needed to run the SaaS"
echo "  on a fresh Ubuntu/Debian VPS."
echo ""

# ── Preflight: must run as root ───────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    fail "Please run as root: sudo bash deploy/install-full-saas.sh"
fi

# ── Preflight: detect Ubuntu/Debian ──────────────────────────────────────────
if ! command -v apt-get &>/dev/null; then
    fail "This installer requires apt-get (Ubuntu/Debian). Detected OS is not supported."
fi

# ── Resolve project root (script lives in deploy/) ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_SRC="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ ! -f "${PROJECT_SRC}/requirements.txt" ]; then
    fail "requirements.txt not found. Run this script from the project's deploy/ directory."
fi

# =============================================================================
#  SECTION 0 — Interactive questions
# =============================================================================
section "Configuration"
echo "  Please answer the following questions."
echo "  Press ENTER to accept the default value shown in [brackets]."
echo ""

# Helper: ask with optional default
ask() {
    local prompt="$1"
    local default="${2:-}"
    local var_name="$3"
    local value=""
    while true; do
        if [ -n "$default" ]; then
            echo -n "  ${prompt} [${default}]: "
        else
            echo -n "  ${prompt}: "
        fi
        read -r value
        if [ -z "$value" ] && [ -n "$default" ]; then
            value="$default"
        fi
        if [ -n "$value" ]; then
            break
        fi
        echo "  ${RED}This field is required.${NC}"
    done
    printf -v "$var_name" '%s' "$value"
}

ask "Domain or subdomain (e.g. saas.example.com)" "" DOMAIN
ask "SSL certificate email" "" SSL_EMAIL
ask "Git branch to deploy" "main" GIT_BRANCH
ask "PostgreSQL database name" "tiktokquiz" DB_NAME
ask "PostgreSQL database user" "tiktokquiz" DB_USER

echo -n "  PostgreSQL database password (leave blank to auto-generate): "
read -rs DB_PASS_INPUT
echo ""
if [ -z "$DB_PASS_INPUT" ]; then
    DB_PASS="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
    info "Auto-generated database password (saved to env file)"
else
    DB_PASS="$DB_PASS_INPUT"
fi

ask "Application install directory" "/opt/tiktok-quiz-saas" APP_DIR
ask "systemd service name" "tiktok-quiz-saas" SERVICE_NAME

echo ""
echo -e "  ${BOLD}Summary of your choices:${NC}"
echo "  ─────────────────────────────────────────────────"
echo "  Domain         : ${DOMAIN}"
echo "  SSL email      : ${SSL_EMAIL}"
echo "  Git branch     : ${GIT_BRANCH}"
echo "  Database name  : ${DB_NAME}"
echo "  Database user  : ${DB_USER}"
echo "  Install dir    : ${APP_DIR}"
echo "  Service name   : ${SERVICE_NAME}"
echo "  ─────────────────────────────────────────────────"
echo ""
echo -n "  Proceed with installation? [Y/n]: "
read -r CONFIRM
CONFIRM="${CONFIRM:-y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Installation cancelled."
    exit 0
fi

# ── Derived constants ─────────────────────────────────────────────────────────
LOG_DIR="/var/log/tiktok-quiz-saas"
ENV_DIR="/etc/tiktok-quiz-saas"
ENV_FILE="${ENV_DIR}/saas.env"
VENV="${APP_DIR}/venv"
NGINX_SITE_NAME="tiktok-quiz-saas"
GUNICORN_BIND="127.0.0.1:5001"
HEALTH_URL="http://${GUNICORN_BIND}/api/health"

# =============================================================================
#  SECTION 1 — System packages
# =============================================================================
section "1 / 14 — System packages"

info "Running apt-get update..."
apt-get update -qq

PKGS=(
    git curl wget gnupg2 lsb-release ca-certificates
    nginx
    certbot python3-certbot-nginx
    python3 python3-venv python3-pip python3-dev
    postgresql postgresql-contrib
    build-essential libpq-dev
    rsync openssl
)

info "Installing packages: ${PKGS[*]}"
apt-get install -y -qq "${PKGS[@]}"
ok "System packages installed"

# =============================================================================
#  SECTION 2 — Node.js LTS
# =============================================================================
section "2 / 14 — Node.js LTS"

if command -v node &>/dev/null && node --version | grep -qE '^v(18|20|22)\.'; then
    ok "Node.js $(node --version) already present (LTS)"
else
    info "Installing Node.js 20 LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
fi

command -v node &>/dev/null || fail "node binary not found after installation. Check NodeSource setup."
command -v npm  &>/dev/null || fail "npm binary not found after installation."
NODE_VER="$(node -v)"
NPM_VER="$(npm -v)"
ok "Node.js ${NODE_VER} | npm ${NPM_VER}"

# =============================================================================
#  SECTION 3 — Clone or update the repository
# =============================================================================
section "3 / 14 — Project files"

# Determine git remote from the current checkout (if available)
GIT_REMOTE=""
if [ -d "${PROJECT_SRC}/.git" ]; then
    GIT_REMOTE="$(git -C "${PROJECT_SRC}" remote get-url origin 2>/dev/null || true)"
fi

if [ -d "${APP_DIR}/.git" ]; then
    info "Repository already exists at ${APP_DIR}. Fetching and updating..."
    git -C "${APP_DIR}" fetch origin
    git -C "${APP_DIR}" checkout "${GIT_BRANCH}"
    git -C "${APP_DIR}" pull origin "${GIT_BRANCH}"
    ok "Repository updated to branch '${GIT_BRANCH}'"
elif [ -n "${GIT_REMOTE}" ]; then
    info "Cloning ${GIT_REMOTE} → ${APP_DIR}..."
    mkdir -p "$(dirname "${APP_DIR}")"
    git clone --branch "${GIT_BRANCH}" "${GIT_REMOTE}" "${APP_DIR}"
    ok "Repository cloned"
else
    info "No remote git URL detected. Syncing from local project source (${PROJECT_SRC})..."
    mkdir -p "${APP_DIR}"
    rsync -a \
        --exclude='venv/' \
        --exclude='node_modules/' \
        --exclude='.git/' \
        --exclude='__pycache__/' \
        --exclude='*.pyc' \
        --exclude='dist/' \
        --exclude='data/*.db' \
        --exclude='tmp/' \
        "${PROJECT_SRC}/" "${APP_DIR}/"
    ok "Project files synced to ${APP_DIR}"
fi

# =============================================================================
#  SECTION 4 — Python virtual environment
# =============================================================================
section "4 / 14 — Python environment"

if [ ! -d "${VENV}" ]; then
    info "Creating Python venv..."
    python3 -m venv "${VENV}"
fi

info "Upgrading pip..."
"${VENV}/bin/pip" install --upgrade pip -q

info "Installing Python dependencies from requirements.txt..."
"${VENV}/bin/pip" install -r "${APP_DIR}/requirements.txt" -q
ok "Python dependencies installed"

# =============================================================================
#  SECTION 5 — PostgreSQL setup
# =============================================================================
section "5 / 14 — PostgreSQL"

info "Ensuring PostgreSQL is started and enabled..."
systemctl enable postgresql --quiet
systemctl start postgresql
ok "PostgreSQL service running"

info "Creating database user '${DB_USER}' if not exists..."
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
ok "Database user '${DB_USER}' ready (no CREATEDB, least privilege)"

info "Creating database '${DB_NAME}' if not exists..."
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}')
\gexec
SQL
ok "Database '${DB_NAME}' ready"

info "Granting connect and usage privileges..."
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<SQL
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT USAGE  ON SCHEMA public TO ${DB_USER};
GRANT CREATE ON SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${DB_USER};
SQL
ok "Privileges granted (connect, schema usage, table DML — no superuser)"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

# =============================================================================
#  SECTION 6 — Environment file
# =============================================================================
section "6 / 14 — Environment file"

mkdir -p "${ENV_DIR}"
chown root:www-data "${ENV_DIR}"
chmod 750 "${ENV_DIR}"

JWT_SECRET="$(openssl rand -hex 32)"

cat > "${ENV_FILE}" <<EOF
# TikTok Quiz SaaS — Production environment
# Generated by install-full-saas.sh on $(date -u '+%Y-%m-%d %H:%M UTC')
# Edit this file to add Stripe keys or change settings.
# Restart the service after any change: systemctl restart ${SERVICE_NAME}

DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_HOURS=168
BCRYPT_ROUNDS=12

SAAS_PORT=5001
APP_BASE_URL=https://${DOMAIN}
SAAS_BASE_URL=https://${DOMAIN}
CORS_ORIGINS=https://${DOMAIN}

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
ok "Environment file written: ${ENV_FILE}"

# =============================================================================
#  SECTION 7 — Frontend build
# =============================================================================
section "7 / 14 — Frontend build"

cd "${APP_DIR}"

info "Installing npm dependencies..."
npm ci --silent 2>/dev/null || npm install --silent

info "Writing .env.production..."
cat > "${APP_DIR}/.env.production" <<EOF
VITE_SAAS_API_URL=https://${DOMAIN}
EOF

info "Running production build..."
npm run build || fail "Frontend build failed. Check the output above."
[ -f "${APP_DIR}/dist/index.html" ] || fail "Build produced no dist/index.html."
ok "Frontend built successfully → ${APP_DIR}/dist/"

# =============================================================================
#  SECTION 8 — Gunicorn configuration
# =============================================================================
section "8 / 14 — Gunicorn configuration"

mkdir -p "${LOG_DIR}"
touch "${LOG_DIR}/saas-access.log" "${LOG_DIR}/saas-error.log"
chown -R www-data:www-data "${LOG_DIR}"
chmod 755 "${LOG_DIR}"
chmod 644 "${LOG_DIR}/saas-access.log" "${LOG_DIR}/saas-error.log"
ok "Log directory created: ${LOG_DIR}"

mkdir -p /tmp/gunicorn
chown www-data:www-data /tmp/gunicorn
chmod 755 /tmp/gunicorn
ok "Gunicorn worker tmp dir created: /tmp/gunicorn"

cat > "${APP_DIR}/deploy/gunicorn.conf.py" <<EOF
# Gunicorn production config — generated by install-full-saas.sh
# workers MUST remain 1: SessionManager is an in-memory singleton.
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

ok "Gunicorn config written: ${APP_DIR}/deploy/gunicorn.conf.py"

info "Verifying www-data can read env file and write log files..."
sudo -u www-data test -r "${ENV_FILE}" \
    || fail "www-data cannot read ${ENV_FILE}. Check ownership/permissions on ${ENV_DIR} and ${ENV_FILE}."
sudo -u www-data test -w "${LOG_DIR}/saas-error.log" \
    || fail "www-data cannot write ${LOG_DIR}/saas-error.log. Check ownership/permissions on ${LOG_DIR}."
ok "Permission checks passed (www-data can read env, write logs)"

# =============================================================================
#  SECTION 9 — Database schema bootstrap
# =============================================================================
section "9 / 14 — Database schema bootstrap"

info "Running idempotent schema bootstrap..."
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

if [ $BOOTSTRAP_EXIT -eq 0 ]; then
    ok "Database schema created / verified"
else
    warn "Bootstrap reported an error — will retry after service start."
    warn "Manual retry: sudo ${VENV}/bin/python3 -m backend.saas.db.bootstrap"
fi

# =============================================================================
#  SECTION 10 — systemd service
# =============================================================================
section "10 / 14 — systemd service"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=TikTok Quiz SaaS Backend
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
ok "Service file written: ${SERVICE_FILE}"

# =============================================================================
#  SECTION 11 — Nginx site configuration
# =============================================================================
section "11 / 14 — Nginx"

NGINX_CONF="/etc/nginx/sites-available/${NGINX_SITE_NAME}"

cat > "${NGINX_CONF}" <<NGINX
# TikTok Quiz SaaS — Nginx config
# Generated by install-full-saas.sh on $(date -u '+%Y-%m-%d %H:%M UTC')

limit_req_zone \$binary_remote_addr zone=saas_api:10m rate=120r/m;

server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 10M;

    add_header X-Frame-Options        "SAMEORIGIN"                      always;
    add_header X-Content-Type-Options "nosniff"                         always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;

    # ------------------------------------------------------------------
    # Per-session WebSocket proxy — path-based, no raw ports exposed.
    # Browser:  wss://<domain>/saas-ws/<port>
    # nginx:    ws://127.0.0.1:<port>
    # Range:    9100-9199  (regex 91[0-9][0-9] avoids PCRE {n} syntax)
    # ------------------------------------------------------------------
    location ~ ^/saas-ws/(91[0-9][0-9])\$ {
        set \$ws_port \$1;

        proxy_pass          http://127.0.0.1:\$ws_port;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade    \$http_upgrade;
        proxy_set_header    Connection "Upgrade";
        proxy_set_header    Host       \$host;
        proxy_set_header    X-Real-IP  \$remote_addr;
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
        proxy_buffering     off;
    }

    # Overlay TTS audio files served directly from disk.
    # Must be placed before the generic /overlay-assets/ proxy block so
    # nginx matches this longer prefix first and bypasses Flask entirely.
    # alias maps /overlay-assets/audio/ → ${APP_DIR}/data/audio/
    location ^~ /overlay-assets/audio/ {
        alias      ${APP_DIR}/data/audio/;
        access_log off;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Background music files served directly from disk.
    # alias maps /overlay-assets/music/ → ${APP_DIR}/data/music/
    location ^~ /overlay-assets/music/ {
        alias      ${APP_DIR}/data/music/;
        access_log off;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Overlay static assets (CSS, JS, sounds) served by Flask.
    # ^~ wins over the generic ~* regex below — prevents dist/ from
    # intercepting .js/.css/.mp3 files that belong to Flask/overlay.
    location ^~ /overlay-assets/ {
        proxy_pass         http://${GUNICORN_BIND};
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    # Overlay HTML page served by Flask
    location ^~ /overlay {
        proxy_pass         http://${GUNICORN_BIND};
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    # SaaS REST API
    location /api/ {
        limit_req zone=saas_api burst=40 nodelay;
        limit_req_status 429;
        proxy_pass         http://${GUNICORN_BIND};
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    # Frontend SPA
    location / {
        root       ${APP_DIR}/dist;
        try_files  \$uri \$uri/ /index.html;
        expires    1h;
        add_header Cache-Control "public, max-age=3600";
    }

    # Vite hashed assets — cache forever
    location ~* \\.(?:js|css|woff2?|png|jpg|svg|ico)\$ {
        root       ${APP_DIR}/dist;
        expires    max;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }
}
NGINX

ln -sf "${NGINX_CONF}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
[ -f "/etc/nginx/sites-enabled/default" ] && rm -f "/etc/nginx/sites-enabled/default" || true

info "Testing Nginx configuration..."
nginx -t || fail "Nginx config test failed. Check output above."
ok "Nginx config valid"

# =============================================================================
#  SECTION 12 — Permissions
# =============================================================================
section "12 / 14 — File permissions"

chown -R www-data:www-data "${APP_DIR}" "${LOG_DIR}"
chmod -R o-rwx "${APP_DIR}"
ok "Permissions set (www-data)"

# =============================================================================
#  SECTION 13 — Start services
# =============================================================================
section "13 / 14 — Starting services"

info "Reloading Nginx..."
systemctl reload nginx
ok "Nginx reloaded"

info "Starting ${SERVICE_NAME}..."
systemctl restart "${SERVICE_NAME}"
info "Waiting for service to initialise (10s)..."
sleep 10

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    ok "Service ${SERVICE_NAME} is active"
else
    warn "Service not active — checking logs..."
    journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
    warn "Service did not start cleanly. Check logs above and re-run after fixing."
fi

# =============================================================================
#  SECTION 14 — SSL with Certbot
# =============================================================================
section "14 / 14 — SSL / Certbot"

SSL_OK=false
info "Requesting SSL certificate for ${DOMAIN}..."

set +e
certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "${SSL_EMAIL}" \
    --redirect \
    -d "${DOMAIN}" 2>&1
CERTBOT_EXIT=$?
set -e

if [ $CERTBOT_EXIT -eq 0 ]; then
    SSL_OK=true
    ok "SSL certificate obtained. HTTPS enabled."

    info "Adding HSTS header to HTTPS server block only..."
    # Certbot rewrites the config and adds an SSL server block.
    # Inject HSTS into the HTTPS (port 443 / ssl) block only — never the plain HTTP block.
    python3 - "${NGINX_CONF}" <<'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

hsts = '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n'

# Match the SSL server block (certbot adds "ssl" keyword to the listen directive)
# Insert HSTS after the first server_name line inside an ssl block.
def inject(m):
    block = m.group(0)
    if 'ssl' not in block[:200]:
        return block
    if 'Strict-Transport-Security' in block:
        return block
    return re.sub(
        r'([ \t]*server_name[^\n]+\n)',
        r'\1' + hsts,
        block,
        count=1
    )

result = re.sub(r'server\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}', inject, content, flags=re.DOTALL)
with open(path, 'w') as f:
    f.write(result)
print("  HSTS injected into HTTPS server block")
PYEOF

    nginx -t && systemctl reload nginx || true
else
    warn "Certbot failed (exit ${CERTBOT_EXIT})."
    warn "Possible causes: DNS not yet propagated, port 80 blocked, or wrong email."
    warn "The app is still reachable over HTTP at http://${DOMAIN}"
    warn "Re-run SSL manually later: sudo certbot --nginx -d ${DOMAIN} --email ${SSL_EMAIL}"
    warn "The installation is NOT broken — only SSL is pending."
fi

# =============================================================================
#  Final health check
# =============================================================================
section "Final verification"

info "Checking systemd service status..."
systemctl is-active --quiet "${SERVICE_NAME}" \
    && ok "Service: ACTIVE" \
    || warn "Service: INACTIVE (check: journalctl -u ${SERVICE_NAME} -n 50)"

info "Checking Nginx status..."
systemctl is-active --quiet nginx \
    && ok "Nginx: ACTIVE" \
    || warn "Nginx: INACTIVE (check: nginx -t)"

info "Running HTTP health check against ${HEALTH_URL} (6 attempts, 5s apart)..."
HEALTH_PASS=false
for attempt in 1 2 3 4 5 6; do
    if curl -sf --max-time 8 "http://127.0.0.1:5001/api/health" >/dev/null 2>&1; then
        HEALTH_PASS=true
        ok "Health check passed on attempt ${attempt}"
        break
    fi
    if [ "$attempt" -lt 6 ]; then
        info "Attempt ${attempt}/6 failed — retrying in 5s..."
        sleep 5
    fi
done
if ! "${HEALTH_PASS}"; then
    journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
    fail "Health check failed after 6 attempts. Service did not become healthy. Check logs above."
fi

# =============================================================================
#  Summary
# =============================================================================
PROTO="http"
"${SSL_OK}" && PROTO="https"

echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              Installation Complete                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}App directory   :${NC} ${APP_DIR}"
echo -e "  ${BOLD}Domain          :${NC} ${PROTO}://${DOMAIN}"
echo -e "  ${BOLD}Service         :${NC} ${SERVICE_NAME}"
echo -e "  ${BOLD}Env file        :${NC} ${ENV_FILE}"
echo -e "  ${BOLD}Log directory   :${NC} ${LOG_DIR}"
if "${HEALTH_PASS}"; then
    echo -e "  ${BOLD}Health check    :${NC} ${GREEN}PASS${NC}"
else
    echo -e "  ${BOLD}Health check    :${NC} ${YELLOW}PENDING${NC}"
fi
if ! "${SSL_OK}"; then
    echo -e "  ${BOLD}SSL             :${NC} ${YELLOW}PENDING — run certbot manually${NC}"
fi
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo "  ─────────────────────────────────────────────────────────────"
echo "  systemctl status  ${SERVICE_NAME}"
echo "  journalctl -u ${SERVICE_NAME} -f"
echo "  sudo nano ${ENV_FILE}"
echo "  sudo systemctl restart ${SERVICE_NAME}"
echo "  sudo bash ${APP_DIR}/deploy/deploy.sh ${GIT_BRANCH}   # future deploys"
echo ""
echo -e "  ${YELLOW}Next step — add your Stripe keys to ${ENV_FILE}${NC}"
echo "  then run: sudo systemctl restart ${SERVICE_NAME}"
echo ""
