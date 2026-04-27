#!/bin/bash
set -e

APP_DIR="/opt/tiktok-quiz"
LOG_DIR="/var/log/tiktok-quiz"

echo "=== TikTok Quiz - VPS Setup ==="

if [ "$EUID" -ne 0 ]; then
    echo "Executez ce script en root: sudo bash setup.sh"
    exit 1
fi

echo "[1/6] Creation des repertoires..."
mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR"

echo "[2/6] Copie des fichiers..."
rsync -av --exclude='venv' --exclude='node_modules' --exclude='.git' --exclude='__pycache__' \
    "$(dirname "$0")/../" "$APP_DIR/"

echo "[3/6] Creation de l'environnement Python..."
cd "$APP_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "[4/6] Installation du service systemd..."
cp deploy/tiktok-quiz.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable tiktok-quiz

echo "[5/6] Configuration Nginx..."
cp deploy/nginx.conf /etc/nginx/sites-available/tiktok-quiz
ln -sf /etc/nginx/sites-available/tiktok-quiz /etc/nginx/sites-enabled/tiktok-quiz
echo "IMPORTANT: Editez /etc/nginx/sites-available/tiktok-quiz pour mettre votre domaine"

echo "[6/6] Permissions..."
chown -R www-data:www-data "$APP_DIR"
chown -R www-data:www-data "$LOG_DIR"

echo ""
echo "=== Setup termine ==="
echo ""
echo "Prochaines etapes:"
echo "  1. Editez /etc/nginx/sites-available/tiktok-quiz (domaine)"
echo "  2. sudo nginx -t && sudo systemctl reload nginx"
echo "  3. sudo systemctl start tiktok-quiz"
echo "  4. sudo systemctl status tiktok-quiz"
echo ""
echo "Commandes utiles:"
echo "  sudo systemctl start tiktok-quiz    # Demarrer le serveur"
echo "  sudo systemctl stop tiktok-quiz     # Arreter le serveur"
echo "  sudo systemctl restart tiktok-quiz  # Redemarrer le serveur"
echo "  sudo journalctl -u tiktok-quiz -f   # Voir les logs"
echo ""
