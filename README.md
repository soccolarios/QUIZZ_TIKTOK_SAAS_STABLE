# QUIZZ_TIKTOK

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-urgbkuka)

## Production Deployment (VPS)

### Full automated install (fresh Ubuntu 22.04 / 24.04 VPS)

```bash
# Clone the repository on the server, then:
sudo bash deploy/install-full-saas.sh
```

The installer is fully interactive. It will ask for:

- Domain / subdomain (e.g. `saas.example.com`)
- SSL certificate email
- Git branch (default: `main`)
- PostgreSQL database name, user, and password
- App install directory (default: `/opt/tiktok-quiz`)
- systemd service name (default: `tiktok-quiz-saas`)

It then handles automatically:
1. System packages (nginx, certbot, postgresql, python3, node…)
2. Node.js 20 LTS
3. Project clone / sync
4. Python virtual environment + dependencies
5. PostgreSQL local user + database creation
6. Production environment file (`/etc/tiktok-quiz/saas.env`)
7. Frontend build (`npm run build`)
8. Gunicorn config (workers=1, gthread)
9. Database schema bootstrap (idempotent)
10. systemd service install + enable
11. Nginx site config with security headers
12. SSL certificate via Certbot
13. Service start + final health check

The script is **idempotent** — safe to re-run after changes.

### Subsequent deploys

```bash
sudo bash deploy/deploy.sh main
```

This performs a graceful zero-interruption redeploy: SIGTERM drain → code update → pip/npm install → frontend build → service restart → health check with automatic rollback.

### Useful commands

```bash
systemctl status tiktok-quiz-saas
journalctl -u tiktok-quiz-saas -f
sudo nano /etc/tiktok-quiz/saas.env
sudo systemctl restart tiktok-quiz-saas
```
