# LiveGine Mailjet Security Checklist

Pre-launch checklist for transactional email security and deliverability.

---

## 1. Sender Domain Authentication

| Step | Action | Status |
|------|--------|--------|
| 1.1 | Add sender domain in Mailjet Dashboard > Sender domains & addresses | [ ] |
| 1.2 | Configure **SPF** record: add `include:spf.mailjet.com` to your DNS TXT record | [ ] |
| 1.3 | Configure **DKIM**: add the TXT record provided by Mailjet (selector: `mailjet`) | [ ] |
| 1.4 | Configure **DMARC**: add `_dmarc.yourdomain.com` TXT record (start with `p=none` for monitoring) | [ ] |
| 1.5 | Verify all records propagated: `dig TXT yourdomain.com`, `dig TXT mailjet._domainkey.yourdomain.com` | [ ] |
| 1.6 | Validate in Mailjet Dashboard > Sender domains: all three show green checkmarks | [ ] |

### Recommended DMARC policy progression

1. **Week 1-2**: `v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com`
2. **Week 3-4**: `v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc-reports@yourdomain.com`
3. **Week 5+**: `v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com`

---

## 2. Mailjet Account Configuration

| Step | Action | Status |
|------|--------|--------|
| 2.1 | Verify sender email address in Mailjet Dashboard | [ ] |
| 2.2 | Confirm API key and Secret key are stored in LiveGine admin config (not env vars) | [ ] |
| 2.3 | Enable 2FA on your Mailjet account | [ ] |
| 2.4 | Review sub-account permissions if using Mailjet sub-accounts | [ ] |

---

## 3. Application Security Audit

| Step | Action | Status |
|------|--------|--------|
| 3.1 | Confirm Mailjet secrets are masked in GET `/api/admin/config/mailjet` (shows `xxxx****xxxx`) | [ ] |
| 3.2 | Confirm PUT preserves existing secrets when masked placeholder values are submitted | [ ] |
| 3.3 | Confirm no raw API keys appear in application logs (`grep -r "api_key" logs/`) | [ ] |
| 3.4 | Confirm no raw reset tokens appear in logs (only hashed values stored in DB) | [ ] |
| 3.5 | Confirm `email_log` table does not store HTML body, only metadata | [ ] |
| 3.6 | Confirm error messages logged from Mailjet API do not contain credentials | [ ] |

---

## 4. Rate Limiting Verification

| Step | Action | Status |
|------|--------|--------|
| 4.1 | Password reset: per-email cooldown (1 request per 60 seconds) | [ ] |
| 4.2 | Password reset: per-IP flood protection (5 requests per 15 minutes) | [ ] |
| 4.3 | Confirm reset: per-IP brute-force protection (10 attempts per 15 minutes) | [ ] |
| 4.4 | Test email: per-admin rate limit (3 sends per 5 minutes) | [ ] |
| 4.5 | Verify `auth_rate_limits` table is created and indexed | [ ] |
| 4.6 | Verify expired rate limit records are cleaned up periodically | [ ] |

---

## 5. Password Reset Security

| Step | Action | Status |
|------|--------|--------|
| 5.1 | Tokens generated with `secrets.token_urlsafe(48)` (cryptographic PRNG) | [ ] |
| 5.2 | Only SHA-256 hash stored in DB; raw token exists only in email link | [ ] |
| 5.3 | Tokens expire after configurable period (default: 30 minutes) | [ ] |
| 5.4 | Requesting new reset invalidates all previous tokens for that user | [ ] |
| 5.5 | Consumed tokens cannot be reused | [ ] |
| 5.6 | Expired/consumed tokens cleaned up opportunistically (24h retention) | [ ] |
| 5.7 | `/api/auth/request-reset` always returns 200 (prevents email enumeration) | [ ] |
| 5.8 | Password changed confirmation email sent after successful reset | [ ] |

---

## 6. Feature Flag Safety

| Step | Action | Status |
|------|--------|--------|
| 6.1 | `emailEnabled=false` prevents all email sends without crashing any flow | [ ] |
| 6.2 | Disabled emails are logged to `email_log` with status `skipped` | [ ] |
| 6.3 | Auth flows (register, login, password reset) remain functional when email is disabled | [ ] |
| 6.4 | Billing webhooks process correctly when email is disabled | [ ] |
| 6.5 | Admin actions (suspend, override) complete successfully when email is disabled | [ ] |

---

## 7. Bounce & Complaint Monitoring

| Step | Action | Status |
|------|--------|--------|
| 7.1 | Configure Mailjet webhook for bounce events (optional but recommended) | [ ] |
| 7.2 | Configure Mailjet webhook for spam complaints (optional but recommended) | [ ] |
| 7.3 | Monitor Mailjet Dashboard > Statistics for delivery rates | [ ] |
| 7.4 | Set up alerting if bounce rate exceeds 5% | [ ] |

---

## 8. Sandbox Testing

Before going live, test every email template:

| Template | Trigger | Tested |
|----------|---------|--------|
| Welcome | Register new user | [ ] |
| Password Reset | Request password reset | [ ] |
| Password Changed | Complete password reset | [ ] |
| Subscription Activated | Stripe checkout.session.completed | [ ] |
| Payment Success | Stripe invoice.paid | [ ] |
| Payment Failed | Stripe invoice.payment_failed | [ ] |
| Subscription Canceled | Stripe customer.subscription.deleted | [ ] |
| Account Suspended | Admin suspends user | [ ] |
| Account Unsuspended | Admin unsuspends user | [ ] |
| Plan Override | Admin overrides plan | [ ] |
| Test Email | Admin sends test from Mailjet config | [ ] |

---

## 9. Production Go-Live

| Step | Action | Status |
|------|--------|--------|
| 9.1 | All DNS records validated (SPF, DKIM, DMARC) | [ ] |
| 9.2 | Mailjet keys configured via admin panel (not env vars) | [ ] |
| 9.3 | Sender email matches verified domain | [ ] |
| 9.4 | Test email sent and received successfully | [ ] |
| 9.5 | `emailEnabled` feature flag set to `true` | [ ] |
| 9.6 | Rate limit tables created and indexed | [ ] |
| 9.7 | All 11 email templates tested end-to-end | [ ] |
| 9.8 | DMARC monitoring in place (at minimum `p=none` with reporting) | [ ] |
| 9.9 | Mailjet daily/monthly sending limits reviewed and adequate | [ ] |
