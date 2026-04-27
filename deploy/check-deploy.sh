#!/bin/bash
# Post-deployment verification script for the SaaS backend on VPS.
# Usage: sudo bash deploy/check-deploy.sh [DOMAIN]
# Example: sudo bash deploy/check-deploy.sh quiz.mondomaine.com

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

DOMAIN="${1:-localhost}"
SAAS_PORT="${SAAS_PORT:-5001}"
APP_DIR="${APP_DIR:-/opt/tiktok-quiz}"
ENV_FILE="/etc/tiktok-quiz/saas.env"
LOG_DIR="/var/log/tiktok-quiz"
PASS=0
FAIL=0
WARN=0

ok()   { echo -e "  ${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; WARN=$((WARN+1)); }

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  TikTok Quiz SaaS — Post-Deploy Check${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# --------------------------------------------------
echo -e "${BOLD}[1] Fichiers et répertoires${NC}"
# --------------------------------------------------
[ -d "$APP_DIR" ]        && ok "$APP_DIR existe"      || fail "$APP_DIR manquant"
[ -d "$LOG_DIR" ]        && ok "$LOG_DIR existe"      || fail "$LOG_DIR manquant"
[ -f "$APP_DIR/backend/saas/wsgi.py" ] && ok "wsgi.py trouvé" || fail "wsgi.py manquant"
[ -f "$APP_DIR/dist/index.html" ]      && ok "Frontend buildé (dist/index.html)" || warn "dist/index.html absent — lancez: npm run build"
[ -f "$ENV_FILE" ]       && ok "$ENV_FILE existe"     || fail "$ENV_FILE manquant — créez le fichier d'env"

# --------------------------------------------------
echo ""
echo -e "${BOLD}[2] Variables d'environnement critiques${NC}"
# --------------------------------------------------
if [ -f "$ENV_FILE" ]; then
    for VAR in DATABASE_URL JWT_SECRET APP_BASE_URL SAAS_BASE_URL; do
        VALUE=$(grep "^${VAR}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
        if [ -n "$VALUE" ]; then
            ok "$VAR est défini"
        else
            fail "$VAR manquant dans $ENV_FILE"
        fi
    done

    JWT_VAL=$(grep "^JWT_SECRET=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
    if echo "$JWT_VAL" | grep -qiE "^(change_me|secret|jwt_secret)"; then
        fail "JWT_SECRET contient une valeur par défaut — changez-la !"
    elif [ ${#JWT_VAL} -lt 32 ]; then
        warn "JWT_SECRET fait moins de 32 caractères"
    else
        ok "JWT_SECRET a l'air sécurisé"
    fi
else
    fail "Impossible de vérifier les variables (fichier env absent)"
fi

# --------------------------------------------------
echo ""
echo -e "${BOLD}[3] Services systemd${NC}"
# --------------------------------------------------
for SVC in tiktok-quiz-saas nginx; do
    if systemctl is-active --quiet "$SVC" 2>/dev/null; then
        ok "Service $SVC actif"
    else
        if systemctl list-unit-files --quiet "$SVC.service" 2>/dev/null | grep -q "$SVC"; then
            fail "Service $SVC installé mais pas actif"
        else
            warn "Service $SVC non installé (ignoré si non requis)"
        fi
    fi
done

# --------------------------------------------------
echo ""
echo -e "${BOLD}[4] Ports réseau${NC}"
# --------------------------------------------------
if command -v ss &>/dev/null; then
    ss -tlnp | grep -q ":${SAAS_PORT}" && ok "Port ${SAAS_PORT} (SaaS) en écoute" || fail "Port ${SAAS_PORT} pas en écoute"
    ss -tlnp | grep -q ':80 '          && ok "Port 80 (Nginx) en écoute"            || fail "Port 80 pas en écoute"
else
    warn "ss non disponible, vérification des ports ignorée"
fi

# --------------------------------------------------
echo ""
echo -e "${BOLD}[5] Santé de l'API SaaS${NC}"
# --------------------------------------------------
sleep 1
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${SAAS_PORT}/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    ok "GET /api/health → HTTP 200"
elif [ "$HTTP_CODE" = "404" ]; then
    warn "GET /api/health → 404 (endpoint non implémenté, serveur actif)"
else
    fail "GET /api/health → HTTP $HTTP_CODE (serveur inaccessible)"
fi

HTTP_AUTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${SAAS_PORT}/api/quizzes/" 2>/dev/null || echo "000")
if [ "$HTTP_AUTH" = "401" ]; then
    ok "GET /api/quizzes/ → HTTP 401 (auth requise, OK)"
elif [ "$HTTP_AUTH" = "200" ]; then
    warn "GET /api/quizzes/ → HTTP 200 sans token (vérifiez auth middleware)"
else
    fail "GET /api/quizzes/ → HTTP $HTTP_AUTH (inattendu)"
fi

# --------------------------------------------------
echo ""
echo -e "${BOLD}[6] Connexion DB (via psql si disponible)${NC}"
# --------------------------------------------------
if command -v psql &>/dev/null && [ -f "$ENV_FILE" ]; then
    DB_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$DB_URL" ]; then
        if psql "$DB_URL" -c "SELECT 1" -q --no-psqlrc 2>/dev/null | grep -q "1"; then
            ok "Connexion PostgreSQL OK"
        else
            fail "Impossible de se connecter à PostgreSQL"
        fi

        for TABLE in saas_users saas_projects saas_quizzes saas_game_sessions; do
            if psql "$DB_URL" -c "SELECT 1 FROM information_schema.tables WHERE table_name='${TABLE}'" -q --no-psqlrc 2>/dev/null | grep -q "1"; then
                ok "Table ${TABLE} existe"
            else
                fail "Table ${TABLE} manquante — lancez: python3 -m backend.saas.db.bootstrap"
            fi
        done
    else
        warn "DATABASE_URL vide, vérification DB ignorée"
    fi
else
    warn "psql non disponible, vérification DB ignorée"
fi

# --------------------------------------------------
echo ""
echo -e "${BOLD}[7] Nginx via domaine${NC}"
# --------------------------------------------------
if [ "$DOMAIN" != "localhost" ]; then
    HTTP_DOMAIN=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "http://${DOMAIN}/api/health" 2>/dev/null || echo "000")
    [ "$HTTP_DOMAIN" != "000" ] && ok "Nginx répond sur http://${DOMAIN}" || warn "http://${DOMAIN} inaccessible (DNS peut-être pas propagé)"
fi

# --------------------------------------------------
echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  Résultat : ${GREEN}${PASS} PASS${NC}  ${RED}${FAIL} FAIL${NC}  ${YELLOW}${WARN} WARN${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}Des problèmes critiques ont été détectés. Consultez les messages ci-dessus.${NC}"
    echo ""
    echo "Commandes de diagnostic :"
    echo "  sudo journalctl -u tiktok-quiz-saas -n 50"
    echo "  sudo journalctl -u nginx -n 20"
    echo "  sudo tail -50 ${LOG_DIR}/saas-error.log"
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo -e "${YELLOW}Déploiement OK avec des avertissements. Vérifiez les points marqués WARN.${NC}"
else
    echo -e "${GREEN}Tout est OK. Le déploiement est opérationnel.${NC}"
fi
