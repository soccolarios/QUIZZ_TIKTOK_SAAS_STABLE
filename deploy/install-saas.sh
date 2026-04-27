#!/bin/bash
# Installation script for the SaaS backend on a VPS.
# Usage: sudo bash deploy/install-saas.sh
# Prerequisites: PostgreSQL already running, domain DNS pointing to this server.

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

APP_NAME="tiktok-quiz"
APP_DIR="/opt/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
ENV_DIR="/etc/${APP_NAME}"
ENV_FILE="${ENV_DIR}/saas.env"
SERVICE_NAME="${APP_NAME}-saas"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
fail() { echo -e "  ${RED}[ERREUR]${NC} $1"; exit 1; }

[ "$EUID" -ne 0 ] && fail "Exécutez en root : sudo bash deploy/install-saas.sh"
[ ! -f "${PROJECT_DIR}/requirements.txt" ] && fail "requirements.txt introuvable."

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  TikTok Quiz SaaS — Installation VPS${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# --------------------------------------------------
echo -e "${BOLD}[1/9] Informations de déploiement${NC}"
# --------------------------------------------------

DOMAIN=""
while [ -z "$DOMAIN" ]; do
    echo -n "Domaine (ex: quiz.monsite.com) : "
    read -r DOMAIN
done

DB_URL=""
while [ -z "$DB_URL" ]; do
    echo -n "DATABASE_URL (ex: postgresql://user:pass@localhost:5432/quizdb) : "
    read -r DB_URL
done

JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo -e "  JWT_SECRET généré automatiquement : ${CYAN}${JWT_SECRET:0:16}...${NC}"

ENABLE_HTTPS="n"
echo -n "Activer HTTPS avec Certbot ? (o/N) : "
read -r ENABLE_HTTPS
ENABLE_HTTPS=$(echo "$ENABLE_HTTPS" | tr '[:upper:]' '[:lower:]')

# --------------------------------------------------
echo ""
echo -e "${BOLD}[2/9] Paquets système${NC}"
# --------------------------------------------------
apt-get update -qq
PKGS="python3 python3-venv python3-pip nginx rsync curl"
[ "$ENABLE_HTTPS" = "o" ] && PKGS="$PKGS certbot python3-certbot-nginx"
apt-get install -y -qq $PKGS
ok "Paquets installés"

# --------------------------------------------------
echo ""
echo -e "${BOLD}[3/9] Node.js et build frontend${NC}"
# --------------------------------------------------
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
    ok "Node.js $(node --version) installé"
else
    ok "Node.js $(node --version) déjà présent"
fi

# --------------------------------------------------
echo ""
echo -e "${BOLD}[4/9] Copie des fichiers${NC}"
# --------------------------------------------------
mkdir -p "$APP_DIR" "$LOG_DIR"
rsync -a \
    --exclude='venv' --exclude='node_modules' --exclude='.git' \
    --exclude='__pycache__' --exclude='*.pyc' \
    "${PROJECT_DIR}/" "${APP_DIR}/"
ok "Fichiers copiés dans $APP_DIR"

# --------------------------------------------------
echo ""
echo -e "${BOLD}[5/9] Environnement Python${NC}"
# --------------------------------------------------
rm -rf "${APP_DIR}/venv"
python3 -m venv "${APP_DIR}/venv"
"${APP_DIR}/venv/bin/pip" install --upgrade pip -q
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/requirements.txt" -q
ok "Dépendances Python installées"

# --------------------------------------------------
echo ""
echo -e "${BOLD}[6/9] Build frontend${NC}"
# --------------------------------------------------
cd "${APP_DIR}"
npm ci --omit=dev -q 2>/dev/null || npm install --omit=dev -q

PROTO="http"
[ "$ENABLE_HTTPS" = "o" ] && PROTO="https"
PUBLIC_URL="${PROTO}://${DOMAIN}"

VITE_ENV="${APP_DIR}/.env.production"
cat > "$VITE_ENV" <<EOF
VITE_SAAS_API_URL=${PUBLIC_URL}
EOF
ok ".env.production créé (VITE_SAAS_API_URL=${PUBLIC_URL})"

VITE_SAAS_API_URL="$PUBLIC_URL" npm run build -q 2>/dev/null || warn "Build frontend échoué (non bloquant)"
[ -f "${APP_DIR}/dist/index.html" ] && ok "Frontend buildé dans dist/" || warn "dist/ absent"
cd -

# --------------------------------------------------
echo ""
echo -e "${BOLD}[7/9] Fichier d'environnement SaaS${NC}"
# --------------------------------------------------
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

cat > "$ENV_FILE" <<EOF
DATABASE_URL=${DB_URL}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_HOURS=168
BCRYPT_ROUNDS=12
SAAS_PORT=5001
APP_BASE_URL=${PUBLIC_URL}
SAAS_BASE_URL=${PUBLIC_URL}
CORS_ORIGINS=${PUBLIC_URL}
FLASK_ENV=production
FLASK_DEBUG=0
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
STRIPE_PRICE_PREMIUM=
EOF

chmod 640 "$ENV_FILE"
chown root:www-data "$ENV_FILE" 2>/dev/null || chmod 600 "$ENV_FILE"
ok "Fichier env créé : $ENV_FILE"

# --------------------------------------------------
echo ""
echo -e "${BOLD}[8/9] Bootstrap de la base de données${NC}"
# --------------------------------------------------

"${APP_DIR}/venv/bin/python3" -c "
import sys, os
sys.path.insert(0, '${APP_DIR}')
os.environ['DATABASE_URL'] = '${DB_URL}'
from backend.saas.db.bootstrap import run_bootstrap
run_bootstrap()
" && ok "Schéma DB créé / vérifié" || warn "Bootstrap DB échoué — relancez manuellement après correction"

# --------------------------------------------------
echo ""
echo -e "${BOLD}[9/9] Systemd + Nginx${NC}"
# --------------------------------------------------

# Systemd
cp "${APP_DIR}/deploy/saas.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|/opt/tiktok-quiz|${APP_DIR}|g" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|/var/log/tiktok-quiz|${LOG_DIR}|g" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|EnvironmentFile=.*|EnvironmentFile=-${ENV_FILE}|g" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
ok "Service ${SERVICE_NAME} installé"

# Nginx
sed "s|{{DOMAIN}}|${DOMAIN}|g" "${APP_DIR}/deploy/nginx-saas.conf.template" \
    | sed "s|/opt/tiktok-quiz|${APP_DIR}|g" \
    > "/etc/nginx/sites-available/${APP_NAME}-saas"
ln -sf "/etc/nginx/sites-available/${APP_NAME}-saas" "/etc/nginx/sites-enabled/${APP_NAME}-saas"
[ -f "/etc/nginx/sites-enabled/default" ] && rm -f "/etc/nginx/sites-enabled/default"
nginx -t && ok "Config Nginx valide" || fail "Config Nginx invalide"

# Permissions
chown -R www-data:www-data "${APP_DIR}" "${LOG_DIR}"
ok "Permissions appliquées (www-data)"

# Démarrage
systemctl enable "${SERVICE_NAME}" -q
systemctl restart "${SERVICE_NAME}"
systemctl restart nginx
sleep 3

systemctl is-active --quiet "${SERVICE_NAME}" && ok "Service ${SERVICE_NAME} actif" \
    || warn "Service pas actif — vérifiez : journalctl -u ${SERVICE_NAME} -n 50"

# HTTPS
if [ "$ENABLE_HTTPS" = "o" ]; then
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
        --register-unsafely-without-email --redirect 2>&1 \
        && ok "HTTPS activé" || warn "Certbot échoué — relancez : sudo certbot --nginx -d ${DOMAIN}"
fi

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${GREEN}${BOLD}  INSTALLATION TERMINÉE${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""
echo -e "  URL             : ${GREEN}${PUBLIC_URL}${NC}"
echo -e "  Service         : systemctl status ${SERVICE_NAME}"
echo -e "  Logs            : journalctl -u ${SERVICE_NAME} -f"
echo -e "  Env             : sudo nano ${ENV_FILE}"
echo -e "  Vérification    : sudo bash ${APP_DIR}/deploy/check-deploy.sh ${DOMAIN}"
echo ""
echo -e "${YELLOW}Prochaine étape si Stripe :${NC}"
echo "  Éditez ${ENV_FILE} et ajoutez vos clés Stripe"
echo "  sudo systemctl restart ${SERVICE_NAME}"
echo ""
