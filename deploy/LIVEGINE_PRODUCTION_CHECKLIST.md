# LiveGine Production Deployment Checklist

## Pre-Deployment

### 1. DNS Records
- [ ] `livegine.com` A record -> server IP
- [ ] `www.livegine.com` A record -> server IP
- [ ] `app.livegine.com` A record -> server IP
- [ ] `admin.livegine.com` A record -> server IP
- [ ] `api.livegine.com` A record -> server IP (optional)
- [ ] Verify propagation: `dig +short app.livegine.com`

### 2. Server Prerequisites
- [ ] Ubuntu 22.04 or 24.04
- [ ] Root or sudo access
- [ ] Ports 80 and 443 open in firewall
- [ ] At least 2 GB RAM, 20 GB disk

### 3. Environment Variables
- [ ] `.env.production` has `VITE_SAAS_API_URL=` (empty = same-origin)
- [ ] No old domains (alloguide, myallo) anywhere in the repo
- [ ] Stripe keys ready (can be added post-install)

---

## Installation

### 4. Run Installer
```bash
sudo bash deploy/install-livegine.sh
```

The installer is interactive and will prompt for:
- Domain names (landing, app, admin, api)
- SSL email for Let's Encrypt
- Git branch to deploy
- PostgreSQL credentials
- Install directory and service name

### 5. Installer Validates
- DNS resolution for all domains
- No SSL directives in HTTP bootstrap configs
- No leaked old domains in build output
- Health check against `/api/health`

---

## Post-Deployment Verification

### 6. SSL Certificates
- [ ] `curl -I https://livegine.com` returns 200
- [ ] `curl -I https://app.livegine.com` returns 200
- [ ] `curl -I https://admin.livegine.com` returns 200
- [ ] All certs show valid in browser padlock

### 7. API Health
```bash
curl -s https://app.livegine.com/api/health | python3 -m json.tool
```
Expected: `{"ok": true, "service": "tiktok-quiz-saas"}`

### 8. Admin Auth
- [ ] Navigate to `https://admin.livegine.com`
- [ ] Admin login form appears (dark theme)
- [ ] Login with admin credentials succeeds
- [ ] Dashboard loads with stat cards and quick actions
- [ ] Site Config, Pricing Plans, Feature Flags pages load

### 9. App Auth
- [ ] Navigate to `https://app.livegine.com`
- [ ] Landing page renders correctly
- [ ] Registration works
- [ ] Login works
- [ ] Dashboard loads

### 10. Admin API Routing
```bash
curl -s https://admin.livegine.com/api/health | python3 -m json.tool
```
Expected: same response as app domain. Confirms nginx proxy works.

### 11. Database
```bash
sudo -u postgres psql -d livegine -c "\dt"
```
Expected tables:
- `saas_users`
- `saas_projects`
- `saas_quizzes`
- `saas_game_sessions`
- `saas_session_snapshots`
- `saas_session_logs`
- `saas_subscriptions`
- `saas_billing_events`
- `saas_music_tracks`
- `platform_config`

### 12. Public Config
```bash
curl -s https://app.livegine.com/api/config/public | python3 -m json.tool | head -20
```
Expected: JSON with brand, plans, featureGroups, landing, ai, session keys.

---

## Cache Reset

After a rebuild or redeployment:
```bash
sudo systemctl restart livegine
sudo systemctl reload nginx
```

Browser cache: instruct users to hard-refresh (Ctrl+Shift+R) if they see stale UI.

Vite hashed assets have `immutable` cache headers, so new deploys automatically bust cache for changed files.

---

## Stripe Setup

After install, add Stripe keys:
```bash
sudo nano /etc/livegine/saas.env
```

Add:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PREMIUM=price_...
```

Then restart:
```bash
sudo systemctl restart livegine
```

---

## Common Failures

### Admin login shows "Unable to reach the server"
**Cause:** Nginx on admin domain is not proxying `/api/` to the backend.
**Fix:** Check `/etc/nginx/sites-available/livegine-admin` has a `location /api/` block. If missing, re-run installer or add manually:
```nginx
location /api/ {
    proxy_pass         http://127.0.0.1:5001;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

### Health check fails during install
**Cause:** Backend service hasn't started yet or database connection failed.
**Fix:**
```bash
journalctl -u livegine -n 50
sudo -u postgres psql -d livegine -c "SELECT 1"
sudo systemctl restart livegine
```

### "relation does not exist" errors
**Cause:** Database bootstrap didn't run or failed.
**Fix:**
```bash
source /etc/livegine/saas.env
/opt/livegine/venv/bin/python3 -c "
import sys; sys.path.insert(0, '/opt/livegine')
import os; os.environ['DATABASE_URL'] = '${DATABASE_URL}'
from backend.saas.db.bootstrap import run_bootstrap
run_bootstrap()
"
```

### Build contains old domains
**Cause:** `.env.production` has a stale `VITE_SAAS_API_URL`.
**Fix:** Set `VITE_SAAS_API_URL=` (empty) in `.env.production` and rebuild:
```bash
cd /opt/livegine && npm run build
```

### SSL certificate not obtained
**Cause:** DNS not pointing to server, or port 80 blocked.
**Fix:** Verify DNS resolves, firewall allows 80/443, then:
```bash
sudo certbot --nginx -d app.livegine.com --email you@email.com
```

### CORS errors on admin domain
**Cause:** Admin domain not in `CORS_ORIGINS` env var.
**Fix:** Check `/etc/livegine/saas.env`:
```
CORS_ORIGINS=https://app.livegine.com,https://livegine.com,https://admin.livegine.com
```
Then restart the service.

---

## Architecture Summary

```
Browser -> admin.livegine.com
             |
             nginx (SSL + /api/ proxy + SPA fallback)
             |
         /api/* -> Gunicorn (127.0.0.1:5001)
         /*     -> dist/index.html (SPA)
                     |
                     JS detects admin.* hostname
                     |
                     Renders AdminApp (Super Admin shell)
```

```
Browser -> app.livegine.com
             |
             nginx (SSL + /api/ proxy + /overlay proxy + WS proxy + SPA)
             |
         /api/*        -> Gunicorn
         /overlay*     -> Gunicorn
         /saas-ws/*    -> WebSocket (per-session port)
         /*            -> dist/index.html (SPA)
                          |
                          Renders user Dashboard
```
