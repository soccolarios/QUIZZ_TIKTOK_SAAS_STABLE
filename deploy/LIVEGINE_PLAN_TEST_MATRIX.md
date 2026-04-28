# LiveGine Plan Enforcement Test Matrix

## Capacity Limits

| Action | Free | Pro | Premium | Backend Enforcement | Frontend Enforcement |
|--------|------|-----|---------|---------------------|----------------------|
| Create project (over limit) | 1 max | 10 max | 100 max | `plan_guard.check_can_create_project()` -> 403 | "New project" button disabled at limit |
| Create quiz (over limit per project) | 3 max | 50 max | 500 max | `plan_guard.check_can_create_quiz()` -> 403 | "New quiz" + "Import" buttons disabled at limit + lock icon + upgrade hint |
| Start session (over active limit) | 1 max | 5 max | 20 max | `plan_guard.check_can_start_session()` -> 403 | Backend 403 shown via toast |

## Feature Flags (Plan-Based)

| Feature | Free | Pro | Premium | Backend Enforcement | Frontend Enforcement |
|---------|------|-----|---------|---------------------|----------------------|
| X2 bonus mechanic | Blocked | Allowed | Allowed | `check_can_start_session(x2_requested=True)` -> 403 | Toggle disabled + lock icon + upgrade hint |
| TTS voice narration | Blocked | Allowed | Allowed | `check_can_use_tts()` -> 403 in `set_session_tts` + 403 at launch if requested | Toggle disabled + lock icon + upgrade hint |
| AI quiz generation | Blocked | Allowed | Allowed | `check_can_use_ai()` -> 403 in `/api/ai/generate` | Full page lock with upgrade prompt |
| Music selection | Blocked | Allowed | Allowed | `check_can_use_music()` -> 403 in `/api/music/` + 403 at launch if requested | Music API 403 caught -> empty list shown |

## Global Admin Overrides

When a Super Admin disables a feature globally via Feature Flags in the admin panel:

| Scenario | Effect | Enforcement Point |
|----------|--------|-------------------|
| AI disabled globally | ALL plans lose AI (including Premium) | `plan_guard._is_feature_enabled()` reads `platform_config.feature_flags` |
| TTS disabled globally | ALL plans lose TTS | Same |
| X2 disabled globally | ALL plans lose X2 | `check_can_start_session()` reads global flags |
| Music disabled globally | ALL plans lose music | Same |

## Test Procedures

### FREE Plan Tests

1. **Project cap**
   - Create 1 project -> success
   - Create 2nd project -> 403 "Your plan allows up to 1 project(s). Upgrade to create more."
   - "New project" button shows lock icon and is disabled

2. **Quiz cap**
   - In a project, create 3 quizzes -> success
   - Create 4th quiz -> 403 "Your plan allows up to 3 quiz(zes) per project."
   - "New quiz" and "Import" buttons disabled with lock icon when filtering by that project
   - Quota badge shows "3/3 quizzes"

3. **Session cap**
   - Start 1 session -> success
   - Start 2nd session -> 403 "Your Free plan allows 1 active session(s)."

4. **AI denied**
   - Navigate to AI Generator -> locked page with upgrade prompt
   - POST /api/ai/generate -> 403 "not available on the Free plan"

5. **X2 denied**
   - Launch with x2_enabled=true -> 403 "X2 bonus mechanic is not available"
   - Toggle in launch UI is disabled with lock icon

6. **TTS denied**
   - POST /api/sessions/:id/audio/tts {enabled: true} -> 403
   - Toggle in launch UI is disabled with lock icon
   - Launch with no_tts=false -> 403 "not available on the Free plan"

7. **Music denied**
   - GET /api/music/ -> 403
   - Music section shows "No music tracks available"
   - Launch with music_track_slug="energetic_1" -> 403 "not available on the Free plan"

### PRO Plan Tests

1. **All capacity limits** -> 5 sessions, 10 projects, 50 quizzes per project
2. **X2 allowed** -> toggle works, session starts with X2
3. **TTS allowed** -> toggle works, TTS activates
4. **AI allowed** -> generator page loads, generation succeeds
5. **Music allowed** -> music list loads, track selection works

### PREMIUM Plan Tests

1. **All capacity limits** -> 20 sessions, 100 projects, 500 quizzes per project
2. **All features allowed** -> same as Pro

### GLOBAL DISABLE Tests

1. Disable AI in admin Feature Flags panel
2. Log in as Pro user -> AI Generator shows locked page
3. POST /api/ai/generate -> 403 "temporarily disabled by the platform administrator"
4. Re-enable AI -> Pro user can generate again
5. Repeat for TTS, X2, Music

## Billing Authority & Plan Sync

### Effective Plan Resolution

`get_effective_plan_code(user_id)` is the SINGLE source of truth. Priority chain:

| Priority | Condition | Effective Plan |
|----------|-----------|----------------|
| 1 (highest) | `suspended_at IS NOT NULL` | `free` |
| 2 | `admin_override_plan_code IS NOT NULL` | override value |
| 3 | `status NOT IN (active, trialing)` | `free` |
| 4 | Normal | Stripe `plan_code` |
| 5 (fallback) | No subscription row | `free` |

### Stripe Webhook Events

| Event | Action | Safety |
|-------|--------|--------|
| `checkout.session.completed` | Resolve price_id -> plan_code, upsert subscription | Fails safely if price_id unknown |
| `customer.subscription.updated` | Sync plan_code + status from Stripe | Skips plan_code update if price_id unknown |
| `customer.subscription.deleted` | Set plan_code=free, status=canceled | Always downgrades |
| `invoice.paid` | Log event | No plan change |
| `invoice.payment_failed` | Set status=past_due (keeps plan_code) | Effective plan resolves to free via status check |

### Admin Billing Controls

| Action | Route | Effect |
|--------|-------|--------|
| Set plan override | `POST /api/admin/billing/subscriptions/:id/override` | Sets `admin_override_plan_code`, takes precedence over Stripe |
| Clear override | Same route with `plan_code: null` | Restores Stripe-managed plan |
| Suspend account | `POST /api/admin/billing/subscriptions/:id/suspend` | Sets `suspended_at`, immediately restricts to free |
| Unsuspend account | Same route with `suspended: false` | Clears `suspended_at`, restores previous effective plan |

All admin actions require reason text and are logged to `billing_events`.

### Billing Security Tests

1. **Expired subscription**
   - Stripe sends `customer.subscription.deleted` -> status=canceled
   - User's effective plan -> free immediately
   - All paid features return 403

2. **Payment failure**
   - Stripe sends `invoice.payment_failed` -> status=past_due
   - Effective plan -> free (status not in active/trialing)
   - User retains plan_code for when payment succeeds

3. **Admin override**
   - Admin sets override to "pro" for a free user
   - User gets pro access immediately
   - Stripe plan_code unchanged (still "free")
   - Admin clears override -> user returns to free

4. **Suspension**
   - Admin suspends a premium user
   - Effective plan -> free immediately, regardless of Stripe status
   - Admin unsuspends -> premium restored

5. **Frontend cannot unlock**
   - No client-side billing state grants access
   - `/api/billing/subscription` returns effective plan from backend
   - All plan checks go through `plan_guard.py` -> `get_effective_plan_code()`

6. **allow_downgrade safety**
   - `upsert_subscription()` defaults `allow_downgrade=False`
   - Prevents accidental paid->free overwrites from stale events
   - Only explicit cancel/delete events pass `allow_downgrade=True`

## Enforcement Architecture

```
User request
    |
    v
Frontend UI check (disable buttons, show upgrade prompts)
    |
    v  (can be bypassed by direct API call)
Backend plan_guard.py
    |
    +-- get_effective_plan_code(user_id)
    |     +-- Check suspended_at -> free
    |     +-- Check admin_override_plan_code -> override
    |     +-- Check status in (active, trialing) -> free if not
    |     +-- Return plan_code or fallback free
    +-- Look up plan limits (config/plans.py)
    +-- Read global feature flags (platform_config table)
    +-- Return (allowed, error_message)
    |
    v
Route handler returns 403 if not allowed
```

Both layers enforce independently. Backend is the source of truth.
