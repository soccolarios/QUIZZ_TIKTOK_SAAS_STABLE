# Production Readiness — TikTok Quiz SaaS

## Formats de quiz supportés

| Format | Structure racine | Détecté par | Utilisable pour |
|---|---|---|---|
| **Legacy** | `{ "questions": [...] }` | clé `questions` de type liste | Sauvegarde, relecture, lancement |
| **Wrapper** | `{ "questionnaires": [ {...} ] }` | clé `questionnaires` de type liste | Sauvegarde, relecture, lancement |

Le moteur de jeu reçoit toujours le Format Legacy normalisé — quel que soit le format d'entrée.

---

## Flux de test production complet

### 1. Register
```
POST /api/auth/register
{ "email": "test@example.com", "password": "motdepasse123" }
→ 201 { "token": "...", "user": { "id": "...", "email": "..." } }
```

### 2. Login
```
POST /api/auth/login
{ "email": "test@example.com", "password": "motdepasse123" }
→ 200 { "token": "...", "user": { ... } }
```
Conserver le `token` pour toutes les requêtes suivantes (header `Authorization: Bearer <token>`).

### 3. Create Project
```
POST /api/projects/
{ "name": "Mon projet de test" }
→ 201 { "id": "<project_id>", "name": "Mon projet de test", ... }
```

### 4. Create Quiz — Format Legacy
```
POST /api/quizzes/
{
  "project_id": "<project_id>",
  "title": "Culture générale",
  "data_json": {
    "id": 1,
    "name": "Culture générale",
    "category": "general",
    "active": true,
    "order": 1,
    "questions": [
      {
        "id": 1,
        "text": "Qui a inventé le téléphone ?",
        "type": "standard",
        "choices": { "A": "Edison", "B": "Bell", "C": "Tesla", "D": "Morse" },
        "correct_answer": "B",
        "difficulty": 1,
        "active": true
      }
    ]
  }
}
→ 201 { "id": "<quiz_legacy_id>", ... }
```

### 5. Create Quiz — Format Wrapper
```
POST /api/quizzes/
{
  "project_id": "<project_id>",
  "title": "Quiz Wrapper",
  "data_json": {
    "questionnaires": [
      {
        "id": 2,
        "name": "Quiz Wrapper",
        "category": "general",
        "active": true,
        "order": 1,
        "questions": [
          {
            "id": 1,
            "text": "Quelle est la capitale de l'Italie ?",
            "type": "standard",
            "choices": { "A": "Milan", "B": "Naples", "C": "Rome", "D": "Turin" },
            "correct_answer": "C",
            "difficulty": 1,
            "active": true
          }
        ]
      }
    ]
  }
}
→ 201 { "id": "<quiz_wrapper_id>", ... }
```

### 6. Start Session
```
POST /api/sessions/start
{
  "project_id": "<project_id>",
  "quiz_id": "<quiz_legacy_id>",
  "simulation_mode": true,
  "no_tts": true,
  "total_questions": 1
}
→ 201 {
  "id": "<session_id>",
  "status": "running",
  "overlay_token": "<token>",
  "overlay_url": "https://<domain>/overlay/<token>",
  "runtime": { "is_active": true, ... }
}
```

### 7. Overlay OBS
```
GET /overlay/<token>
→ 200 (HTML page — à ouvrir dans OBS Browser Source)
```
```
GET /api/overlay/<token>/state
→ 200 { "ok": true, "phase": "...", "runtime_state": "..." }
```

### 8. Pause / Resume / Stop
```
POST /api/sessions/<session_id>/pause   → 200 { "status": "paused" }
POST /api/sessions/<session_id>/resume  → 200 { "status": "running" }
POST /api/sessions/<session_id>/stop    → 200 { "status": "stopped" }
```

### 9. Vérification des cas d'erreur
```
# Format invalide → 400
POST /api/quizzes/  { ..., "data_json": { "name": "sans questions" } }
→ 400 { "error": "Unrecognised format..." }

# correct_answer hors choices → 400
POST /api/quizzes/  { ..., "data_json": { "questions": [{ ..., "correct_answer": "Z" }] } }
→ 400 { "error": "Question[0] correct_answer 'Z' is not a valid choice key..." }

# Accès sans token → 401
GET /api/quizzes/  (sans Authorization header)
→ 401 { "error": "..." }
```

---

## Checklist finale production-ready

### Infrastructure
- [ ] DNS pointant vers le VPS (`A` record)
- [ ] PostgreSQL opérationnel (`systemctl status postgresql`)
- [ ] Schéma créé (`python3 -m backend.saas.db.bootstrap` ou migrations Supabase)
- [ ] Service `tiktok-quiz-saas` actif (`systemctl status tiktok-quiz-saas`)
- [ ] Service `nginx` actif (`systemctl status nginx`)
- [ ] HTTPS actif avec certificat valide (Certbot)

### Configuration `/etc/tiktok-quiz/saas.env`
- [ ] `DATABASE_URL` — connexion PostgreSQL valide
- [ ] `JWT_SECRET` — valeur aléatoire ≥ 32 chars (pas de placeholder)
- [ ] `APP_BASE_URL` — URL publique du frontend (`https://quiz.mondomaine.com`)
- [ ] `SAAS_BASE_URL` — URL publique du backend (même domaine si Nginx proxy)
- [ ] `CORS_ORIGINS` — identique à `APP_BASE_URL`
- [ ] `FLASK_ENV=production` et `FLASK_DEBUG=0`
- [ ] Fichier protégé : `chmod 640`, owner `root:www-data`

### Frontend
- [ ] `VITE_SAAS_API_URL` vide dans `.env` (requêtes relatives) **OU** égal à l'URL publique
- [ ] `npm run build` réussi sans erreur
- [ ] `dist/index.html` présent et servi par Nginx (`location /`)
- [ ] Aucun `localhost` dans `dist/` : `grep -r localhost dist/` → rien
- [ ] Assets statiques avec cache-control immutable (`location ~* \.js$`)

### API
- [ ] `GET /api/health` → HTTP 200 `{ "ok": true }`
- [ ] `GET /api/quizzes/` sans token → HTTP 401
- [ ] `POST /api/auth/register` → HTTP 201
- [ ] `POST /api/auth/login` → HTTP 200 + token JWT
- [ ] `POST /api/quizzes/` format invalide → HTTP 400 avec message précis
- [ ] `POST /api/sessions/start` → HTTP 201 + overlay_url publique (pas localhost)

### Sécurité
- [ ] Pas de `JWT_SECRET` en clair dans les logs ou le code
- [ ] `FLASK_DEBUG=0` en production
- [ ] Rate limiting Nginx actif (`limit_req_zone saas_api`)
- [ ] CORS restreint à l'origine publique uniquement
- [ ] Accès SSH par clé uniquement (mot de passe désactivé)
- [ ] Pare-feu : ports 80, 443 ouverts ; 5001, 5432 fermés en externe

### Logs
- [ ] `/var/log/tiktok-quiz/saas-access.log` existe et se remplit
- [ ] `/var/log/tiktok-quiz/saas-error.log` sans erreur au démarrage
- [ ] `journalctl -u tiktok-quiz-saas -n 20` — pas de STARTUP ERROR

### Script de vérification automatique
```bash
sudo bash /opt/tiktok-quiz/deploy/check-deploy.sh quiz.mondomaine.com
# Résultat attendu : X PASS  0 FAIL  Y WARN (au pire)
```

---

## Points encore fragiles

| Point | Niveau | Description |
|---|---|---|
| Sessions en mémoire | WARN | `session_manager` est in-process. Si gunicorn redémarre, toutes les sessions actives sont perdues. Mitigation : `--workers 1` dans `saas.service`. |
| WebSocket par session | WARN | Ports 9100-9199 alloués en mémoire. Redémarrage = perte de mapping overlay→WS. L'overlay passe en "waiting" automatiquement. |
| `SAAS_BASE_URL` dans sessions.py | FIXE | Corrigé dans ce commit : lecture via `settings` au lieu de `os.environ` au module load. |
| Overlay `frontend/overlay.html` | WARN | Chemin codé en dur dans `overlay.py`. Si le dossier `frontend/` est absent de `APP_DIR`, l'overlay retourne 500. Vérifié par `check-deploy.sh`. |
| Stripe désactivé | INFO | Les clés Stripe sont vides par défaut. Le billing est disponible mais non actif tant que les clés ne sont pas renseignées. |
| `/api/health` absent | FIXE | Endpoint ajouté dans ce commit. `check-deploy.sh` peut maintenant tester la santé de l'API. |
| Nginx sans headers sécurité | WARN | `nginx-saas.conf.template` ne définit pas `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`. À ajouter manuellement après Certbot. |
| Pas de log rotation | WARN | Configurer `logrotate` pour `/var/log/tiktok-quiz/*.log`. |

---

## Fichiers critiques à surveiller

| Fichier | Rôle |
|---|---|
| `/etc/tiktok-quiz/saas.env` | Secrets de production |
| `/etc/systemd/system/tiktok-quiz-saas.service` | Démarrage du backend |
| `/etc/nginx/sites-available/tiktok-quiz-saas` | Proxy reverse et static files |
| `/var/log/tiktok-quiz/saas-error.log` | Erreurs gunicorn |
| `/opt/tiktok-quiz/backend/saas/services/quiz_runtime_loader.py` | Normalisation des formats quiz |
| `/opt/tiktok-quiz/backend/saas/services/session_manager.py` | Registre des sessions actives |
| `/opt/tiktok-quiz/backend/saas/startup_check.py` | Validation au démarrage |
| `/opt/tiktok-quiz/dist/index.html` | Frontend buildé |
