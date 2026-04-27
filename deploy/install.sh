#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

APP_NAME="tiktok-quiz"
APP_DIR="/opt/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
ENV_DIR="/etc/${APP_NAME}"
ENV_FILE="${ENV_DIR}/env"
SERVICE_NAME="${APP_NAME}"
NGINX_SITE="${APP_NAME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

step=0
total_steps=12

log_step() {
    step=$((step + 1))
    echo ""
    echo -e "${CYAN}${BOLD}[${step}/${total_steps}]${NC} ${BOLD}$1${NC}"
    echo "-----------------------------------------------"
}

log_ok() {
    echo -e "  ${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "  ${YELLOW}[!]${NC} $1"
}

log_err() {
    echo -e "  ${RED}[ERREUR]${NC} $1"
}

fail() {
    log_err "$1"
    exit 1
}

echo ""
echo -e "${BOLD}==========================================${NC}"
echo -e "${BOLD}  TikTok Quiz - Installateur VPS${NC}"
echo -e "${BOLD}==========================================${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then
    fail "Ce script doit etre execute en root : sudo bash deploy/install.sh"
fi

if [ ! -f "${PROJECT_DIR}/requirements.txt" ]; then
    fail "requirements.txt introuvable. Lancez ce script depuis la racine du projet."
fi

DOMAIN=""
while [ -z "$DOMAIN" ]; do
    echo -e -n "${YELLOW}Entrez le nom de domaine (ex: quiz.monsite.com) : ${NC}"
    read -r DOMAIN
    if [ -z "$DOMAIN" ]; then
        log_warn "Le nom de domaine ne peut pas etre vide."
    fi
done
echo ""
echo -e "  Domaine : ${GREEN}${DOMAIN}${NC}"

ENABLE_HTTPS="n"
echo ""
echo -e -n "${YELLOW}Activer HTTPS avec Certbot/Let's Encrypt ? (o/N) : ${NC}"
read -r ENABLE_HTTPS
ENABLE_HTTPS=$(echo "$ENABLE_HTTPS" | tr '[:upper:]' '[:lower:]')

# -------------------------------------------------------------------
log_step "Mise a jour du systeme et installation des paquets"
# -------------------------------------------------------------------

apt-get update -qq || fail "Echec de apt-get update"
log_ok "Listes de paquets mises a jour"

PACKAGES="python3 python3-venv python3-pip nginx rsync curl"
if [ "$ENABLE_HTTPS" = "o" ] || [ "$ENABLE_HTTPS" = "oui" ] || [ "$ENABLE_HTTPS" = "y" ] || [ "$ENABLE_HTTPS" = "yes" ]; then
    PACKAGES="${PACKAGES} certbot python3-certbot-nginx"
    ENABLE_HTTPS="o"
fi

apt-get install -y -qq ${PACKAGES} || fail "Echec de l'installation des paquets"
log_ok "Paquets installes : ${PACKAGES}"

# -------------------------------------------------------------------
log_step "Creation des repertoires"
# -------------------------------------------------------------------

mkdir -p "${APP_DIR}"
mkdir -p "${LOG_DIR}"
log_ok "${APP_DIR}"
log_ok "${LOG_DIR}"

# -------------------------------------------------------------------
log_step "Copie des fichiers du projet"
# -------------------------------------------------------------------

rsync -a \
    --exclude='venv' \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    "${PROJECT_DIR}/" "${APP_DIR}/"

log_ok "Fichiers copies dans ${APP_DIR}"

# -------------------------------------------------------------------
log_step "Environnement Python et dependances"
# -------------------------------------------------------------------

if [ -d "${APP_DIR}/venv" ]; then
    log_warn "Environnement virtuel existant detecte, recreation..."
    rm -rf "${APP_DIR}/venv"
fi

python3 -m venv "${APP_DIR}/venv" || fail "Echec de la creation du venv"
log_ok "Environnement virtuel cree"

"${APP_DIR}/venv/bin/pip" install --upgrade pip --quiet || fail "Echec de la mise a jour de pip"
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/requirements.txt" --quiet || fail "Echec de l'installation des dependances Python"
log_ok "Dependances Python installees"

# -------------------------------------------------------------------
log_step "Installation de Node.js et build du frontend"
# -------------------------------------------------------------------

if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || fail "Echec de l'ajout du depot NodeSource"
    apt-get install -y -qq nodejs || fail "Echec de l'installation de Node.js"
    log_ok "Node.js $(node --version) installe"
else
    log_ok "Node.js $(node --version) deja installe"
fi

if [ -f "${APP_DIR}/package.json" ]; then
    cd "${APP_DIR}"
    npm ci --omit=dev --quiet 2>/dev/null || npm install --omit=dev --quiet || fail "Echec de npm install"
    log_ok "Dependances Node.js installees"

    if npm run build --if-present 2>&1; then
        log_ok "Frontend build reussi"
    else
        log_warn "Pas de script build ou echec du build frontend (non bloquant)"
    fi
    cd -
else
    log_warn "Pas de package.json, build frontend ignore"
fi

# -------------------------------------------------------------------
log_step "Configuration du token API admin (ADMIN_API_TOKEN)"
# -------------------------------------------------------------------

mkdir -p "${ENV_DIR}"
chmod 700 "${ENV_DIR}"

if [ -f "${ENV_FILE}" ] && grep -q "^ADMIN_API_TOKEN=" "${ENV_FILE}" 2>/dev/null; then
    EXISTING_TOKEN=$(grep "^ADMIN_API_TOKEN=" "${ENV_FILE}" | cut -d= -f2-)
    if [ -n "${EXISTING_TOKEN}" ]; then
        log_ok "Token existant conserve depuis ${ENV_FILE}"
    else
        ADMIN_API_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
        echo "ADMIN_API_TOKEN=${ADMIN_API_TOKEN}" > "${ENV_FILE}"
        log_ok "Token vide remplace par un nouveau token"
    fi
else
    ADMIN_API_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    echo "ADMIN_API_TOKEN=${ADMIN_API_TOKEN}" > "${ENV_FILE}"
    log_ok "Nouveau token genere dans ${ENV_FILE}"
fi

chmod 640 "${ENV_FILE}"
chown root:www-data "${ENV_FILE}" 2>/dev/null || chmod 600 "${ENV_FILE}"

echo ""
echo -e "  ${YELLOW}${BOLD}IMPORTANT — Token API admin :${NC}"
echo -e "  Fichier : ${CYAN}${ENV_FILE}${NC}"
echo -e "  Pour consulter le token :  ${CYAN}sudo cat ${ENV_FILE}${NC}"
echo -e "  Pour le changer :          ${CYAN}sudo nano ${ENV_FILE}${NC} puis ${CYAN}sudo systemctl restart ${SERVICE_NAME}${NC}"
echo ""

# -------------------------------------------------------------------
log_step "Configuration du service systemd"
# -------------------------------------------------------------------
#
# Architecture : UN SEUL service systemd.
#   - gunicorn lance l'application Flask via create_app()
#   - create_app() demarre le serveur WebSocket (port 8765) dans un thread daemon
#   - quand un jeu est lance depuis le panel, le GameEngine reutilise ce meme WS server
#   - il n'y a qu'une seule source de verite pour l'etat du jeu
#

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=TikTok Quiz - Admin Panel + WebSocket Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/gunicorn \\
    --bind 127.0.0.1:5000 \\
    --workers 1 \\
    --threads 4 \\
    --worker-class gthread \\
    --timeout 120 \\
    --keep-alive 65 \\
    --access-logfile ${LOG_DIR}/access.log \\
    --error-logfile ${LOG_DIR}/error.log \\
    "admin_panel.app:create_app()"
Restart=always
RestartSec=5
EnvironmentFile=-/etc/tiktok-quiz/env
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=${APP_DIR}/backend

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
log_ok "Service ${SERVICE_NAME} installe"
log_ok "Le WebSocket (port 8765) est demarre par create_app() dans le meme processus"

# -------------------------------------------------------------------
log_step "Configuration Nginx"
# -------------------------------------------------------------------

TEMPLATE_FILE="${APP_DIR}/deploy/nginx.conf.template"
if [ ! -f "${TEMPLATE_FILE}" ]; then
    TEMPLATE_FILE="${PROJECT_DIR}/deploy/nginx.conf.template"
fi

if [ ! -f "${TEMPLATE_FILE}" ]; then
    fail "Template nginx introuvable : ${TEMPLATE_FILE}"
fi

sed "s/{{DOMAIN}}/${DOMAIN}/g" "${TEMPLATE_FILE}" > "/etc/nginx/sites-available/${NGINX_SITE}"
log_ok "Configuration Nginx generee pour ${DOMAIN}"

ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
log_ok "Site active dans sites-enabled"

if [ -f "/etc/nginx/sites-enabled/default" ]; then
    rm -f "/etc/nginx/sites-enabled/default"
    log_warn "Site par defaut Nginx desactive"
fi

# -------------------------------------------------------------------
log_step "Test de la configuration Nginx"
# -------------------------------------------------------------------

if nginx -t 2>&1; then
    log_ok "Configuration Nginx valide"
else
    fail "Configuration Nginx invalide. Verifiez /etc/nginx/sites-available/${NGINX_SITE}"
fi

# -------------------------------------------------------------------
log_step "Permissions et demarrage des services"
# -------------------------------------------------------------------

chown -R www-data:www-data "${APP_DIR}"
chown -R www-data:www-data "${LOG_DIR}"
log_ok "Permissions appliquees (www-data)"

systemctl restart nginx
log_ok "Nginx redemarre"

systemctl enable "${SERVICE_NAME}" --quiet
systemctl restart "${SERVICE_NAME}"
log_ok "Service ${SERVICE_NAME} demarre et active au boot"

sleep 3

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    log_ok "Service ${SERVICE_NAME} actif"
else
    log_warn "Le service ${SERVICE_NAME} ne semble pas actif. Verifiez avec : journalctl -u ${SERVICE_NAME} -n 50"
fi

# -------------------------------------------------------------------
log_step "Verification post-installation"
# -------------------------------------------------------------------

CHECKS_PASSED=0
CHECKS_TOTAL=2

echo "  Test 1/2 : Application web (127.0.0.1:5000)..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:5000/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    log_ok "Gunicorn repond sur le port 5000 (HTTP $HTTP_CODE)"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    log_warn "Gunicorn ne repond pas sur le port 5000 (HTTP $HTTP_CODE)"
    log_warn "Verifiez : journalctl -u ${SERVICE_NAME} -n 50"
fi

echo "  Test 2/2 : WebSocket server (127.0.0.1:8765)..."
WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:5000/api/ws-status 2>/dev/null || echo "000")
if [ "$WS_STATUS" = "200" ]; then
    WS_SERVING=$(curl -s --max-time 5 http://127.0.0.1:5000/api/ws-status 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('serving', False))" 2>/dev/null || echo "False")
    if [ "$WS_SERVING" = "True" ]; then
        log_ok "WebSocket server actif sur le port 8765 (via /api/ws-status)"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        log_warn "WebSocket server pas encore pret (serving=$WS_SERVING)"
        log_warn "Verifiez : journalctl -u ${SERVICE_NAME} -n 50"
    fi
else
    if command -v ss &> /dev/null; then
        if ss -tlnp | grep -q ':8765'; then
            log_ok "Port 8765 en ecoute (WebSocket server actif)"
            CHECKS_PASSED=$((CHECKS_PASSED + 1))
        else
            log_warn "Port 8765 pas en ecoute"
            log_warn "Verifiez : journalctl -u ${SERVICE_NAME} -n 50"
        fi
    else
        log_warn "Impossible de verifier le WebSocket server"
    fi
fi

echo ""
if [ "$CHECKS_PASSED" -eq "$CHECKS_TOTAL" ]; then
    log_ok "Toutes les verifications reussies ($CHECKS_PASSED/$CHECKS_TOTAL)"
else
    log_warn "$CHECKS_PASSED/$CHECKS_TOTAL verifications reussies. Consultez les logs ci-dessus."
fi

# -------------------------------------------------------------------
if [ "$ENABLE_HTTPS" = "o" ]; then
    log_step "Configuration HTTPS avec Certbot"
    total_steps=13

    echo -e "  Certbot va demander un certificat SSL pour ${GREEN}${DOMAIN}${NC}"
    echo -e "  ${YELLOW}Assurez-vous que le DNS pointe deja vers ce serveur.${NC}"
    echo ""

    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect 2>&1 && {
        log_ok "Certificat SSL installe et HTTPS active"
    } || {
        log_warn "Certbot a echoue. Vous pouvez relancer manuellement :"
        echo "    sudo certbot --nginx -d ${DOMAIN}"
    }
fi

echo ""
echo -e "${BOLD}==========================================${NC}"
echo -e "${GREEN}${BOLD}  INSTALLATION TERMINEE !${NC}"
echo -e "${BOLD}==========================================${NC}"
echo ""

if [ "$ENABLE_HTTPS" = "o" ]; then
    echo -e "  Panel admin  : ${GREEN}https://${DOMAIN}${NC}"
    echo -e "  Overlay OBS  : ${GREEN}https://${DOMAIN}/overlay${NC}"
    echo -e "  WebSocket    : ${GREEN}wss://${DOMAIN}/ws${NC}"
else
    echo -e "  Panel admin  : ${GREEN}http://${DOMAIN}${NC}"
    echo -e "  Overlay OBS  : ${GREEN}http://${DOMAIN}/overlay${NC}"
    echo -e "  WebSocket    : ${GREEN}ws://${DOMAIN}/ws${NC}"
fi

echo ""
echo -e "${BOLD}Architecture :${NC}"
echo "  Un seul service systemd (${SERVICE_NAME}) gere tout :"
echo "    - Panel admin Flask/gunicorn sur le port 5000"
echo "    - Serveur WebSocket sur le port 8765 (demarre au boot)"
echo "    - Runtime du jeu (demarre/arrete depuis le panel)"
echo ""
echo -e "${BOLD}Token API admin :${NC}"
echo "  sudo cat ${ENV_FILE}                          # Voir le token"
echo "  sudo nano ${ENV_FILE}                         # Modifier le token"
echo "  sudo systemctl restart ${SERVICE_NAME}        # Recharger apres modif token"
echo ""
echo -e "${BOLD}Commandes utiles :${NC}"
echo "  sudo systemctl status ${SERVICE_NAME}         # Statut complet"
echo "  sudo systemctl restart ${SERVICE_NAME}        # Redemarrer tout"
echo "  sudo systemctl stop ${SERVICE_NAME}           # Arreter tout"
echo "  sudo journalctl -u ${SERVICE_NAME} -f         # Logs en temps reel"
echo "  sudo tail -f ${LOG_DIR}/error.log             # Logs gunicorn"
echo ""
echo -e "${BOLD}Diagnostics :${NC}"
echo "  curl http://127.0.0.1:5000/api/status         # Etat du runtime"
echo "  curl http://127.0.0.1:5000/api/ws-status      # Etat du WebSocket"
echo ""

if [ "$ENABLE_HTTPS" != "o" ]; then
    echo -e "${YELLOW}Pour activer HTTPS plus tard :${NC}"
    echo "  sudo apt install certbot python3-certbot-nginx"
    echo "  sudo certbot --nginx -d ${DOMAIN}"
    echo ""
fi
