# Payments and plan subscriptions

JotBox uses Paystack for paid plans. The site shows **Starter Pro at $7 a month** and **Power User at $16 a month**, and checkout charges the Naira equivalent because a Paystack plan is locked to one currency. Nigerian cards are charged in Naira by JotBox itself, not converted silently by Paystack. The old `pro` plan key stays at its original 20-hour allowance for anyone already paying, so a price change never cuts an existing subscriber.

## How the flow works

1. A signed-in person chooses **Upgrade to Starter Pro** or **Upgrade to Power** on `/account`.
2. `POST /api/billing?action=checkout` with `{ "tier": "starter" | "power" }` finds or creates that tier's monthly NGN plan, then asks Paystack for a checkout link.
3. Paystack returns the person to `/account?billing=callback&reference=...`.
4. The app calls `POST /api/billing?action=verify`, and the server confirms the reference with Paystack before marking the plan active.
5. Paystack also posts events to `POST /api/billing`. The webhook is checked with the `x-paystack-signature` HMAC before anything is saved, and event ids are stored so retries cannot apply twice.
6. **Cancel renewal** calls Paystack's disable endpoint. The plan stays on until the paid period ends, and it does not renew.

The webhook and reconciliation resolve the tier from the charge metadata (`plan_key`), the checkout row, or the existing subscription, in that order. A Paystack plan code is only used as supporting evidence, so an old `pro` subscriber cannot be downgraded to Starter by a code lookup. The status card on `/account` reads `GET /api/billing`. Every billing action requires the httpOnly JotBox session.

## Environment

| Name | Purpose |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Server-only key. `sk_test_...` while testing, `sk_live_...` in production. |
| `PAYSTACK_PLAN_CODE` | Optional Starter Pro plan code. It must match the current Starter amount, currency, and interval, or checkout refuses to start. |
| `PAYSTACK_POWER_PLAN_CODE` | Optional Power User plan code, checked the same way against the Power amount. |
| `PAYSTACK_PRO_AMOUNT_NGN` | Starter Pro Naira charged each month. Defaults to `$7 × JOTBOX_USD_TO_NGN`, which is 9,800 Naira. |
| `PAYSTACK_POWER_AMOUNT_NGN` | Power User Naira charged each month. Defaults to `$16 × JOTBOX_USD_TO_NGN`, which is 22,400 Naira. |
| `JOTBOX_USD_TO_NGN` | Display and fallback conversion rate. Defaults to `1400`. |
| `JOTBOX_FREE_MONTH_MINUTES` | Free lifetime listening allowance. Defaults to `100`. The name is kept for compatibility; the allowance no longer resets. |
| `JOTBOX_STARTER_MONTH_HOURS` | Starter Pro listening each calendar month. Defaults to `10`. |
| `JOTBOX_POWER_MONTH_HOURS` | Power User listening each calendar month. Defaults to `25`. |
| `JOTBOX_PRO_MONTH_HOURS` | Legacy Pro listening each calendar month. Defaults to `20`. |
| `JOTBOX_ENTERPRISE_MONTH_HOURS` | Hidden enterprise listening cap each calendar month. Defaults to `1000`; the app shows enterprise as unlimited. |
| `JOTBOX_PUBLIC_URL` | Public origin used for the Paystack callback. Falls back to the request host. |
| `CRON_SECRET` | Bearer token Vercel Cron sends to the daily payment check. Generate a long random string. |

Never add the secret key to a `VITE_` variable, and never commit `.env`. Add the same names to Vercel Production, Preview, and Development as sensitive values. The public key is not used: checkout is a server-created redirect, so only the secret key matters.

In Vercel Production, `PAYSTACK_SECRET_KEY` must start with `sk_live_`. The server refuses every billing call in production while a test key is set.

## Going live

1. Copy the live secret key from **Settings, API Keys and Webhooks** in the Paystack dashboard and save it as `PAYSTACK_SECRET_KEY` in Vercel Production (sensitive). Redeploy afterwards so the function picks it up.
2. Set `PAYSTACK_PRO_AMOUNT_NGN=9800`, `PAYSTACK_POWER_AMOUNT_NGN=22400`, and `JOTBOX_PUBLIC_URL=https://your-domain`.
3. In live mode, set the webhook URL to `https://your-domain/api/billing`.
4. Keep both plan code variables empty unless you created live monthly NGN plans. A test-mode plan code does not exist in live mode, and checkout will fail on it.
5. Make one small live payment on each tier with a real card, confirm the plan turns on, the webhook appears in the Paystack dashboard, and **Cancel renewal** works. Then refund it.

Plans belong to one mode. A plan created with a test key cannot be used with a live key. JotBox checks the stored plan against the live API and creates a fresh one when the cached code is dead or the price changed, so the switch from test to live heals itself on the first checkout.

JotBox creates a plan named `JotBox <tier label> NGN <amount> monthly` the first time someone upgrades that tier. The plan code is cached in `billing_plans` under its `plan_key`; changing a tier amount creates a new plan on the next checkout so existing subscribers keep their old price.

## Database

`db/schema.sql` adds five tables:

- `billing_plans`: the cached Paystack plan code for each paid tier, keyed by `plan_key`.
- `billing_subscriptions`: one row per person, with status, amount, the current paid period, and the Paystack subscription and email tokens.
- `billing_checkouts`: one row per checkout attempt, keyed by the Paystack reference. It also stores the client `Idempotency-Key` so a retried request cannot open a second payment.
- `billing_transactions`: the local money ledger, keyed by `(provider, reference)`. A reference can only be applied once, and `applied_at` records that it was.
- `billing_events`: webhook receipts keyed by event id, used for idempotency, with the user it touched and whether it applied.

Migration `005_usage_metering` adds `captures.recorded_at`, a server-set timestamp used to count listening minutes per calendar month. A client cannot move usage into another month by editing `created_at`.

Migration `007_usage_ledger` moves the meter into `usage_ledger`, keyed by `(user_id, capture_id)`. Each saved capture writes its longest known duration in the same transaction as the capture row, behind a per-user advisory lock. Existing captures are backfilled once. Deleting a capture leaves its ledger row in place, so consumed minutes are never refunded.

Migration `006_billing_hardening` adds the paid period (`current_period_start`, `current_period_end`), event ordering (`last_event_at`, `last_event_id`), reconciliation stamps, and the two new tables.

Migration `017_pricing_tiers` adds `users.free_allowance_started_at` (defaulting to the migration time for existing accounts), `billing_checkouts.plan_key` (defaulting to the legacy `pro` key), and records the tier on every new checkout.

Run `npm run db:migrate` after pulling this change.

## A payment can only count once

Every checkout gets a server-made reference, `jotbox_<uuid>`. That reference is the primary key of `billing_checkouts` and part of the key for `billing_transactions`. The browser return (`action=verify`) and the Paystack webhook both go through `recordTransaction`, which inserts on that key. The second write updates the row and reports `needs_apply = false`, so a retry, a refresh, or a second tab cannot buy a second month.

Checkout is idempotent in three ways:

1. The client sends an `Idempotency-Key` header. The same key returns the same open checkout.
2. A user can only have one live checkout (`creating` or `open`). An abandoned attempt is cleaned up after 90 seconds (`creating`) or 30 minutes (`open`).
3. At most 12 checkout attempts are allowed per user per hour.

## Plans cannot be extended from outside

`validPaidCharge` refuses to grant a plan unless the charge is in Naira, for exactly the amount quoted when that checkout was opened (or the amount the subscriber already pays), and tied to that tier's plan code or metadata. A valid reference for a cheaper transaction is not enough, and rounding tricks do not pass. A Starter checkout can never unlock Power, and a Power charge is not accepted at the Starter amount.

`saveSubscription` writes a paid period through `clampPeriodEnd`, which:

- Never places the end more than 32 days ahead.
- Never shortens an unexpired period that is already on file.
- Falls back to 30 days when Paystack gives no date.

Events also carry an order. `saveSubscription` ignores an event older than `last_event_at`, and a cancellation wins a tie, so a late retry of an old `charge.success` cannot revive a plan the person cancelled. Reconciliation writes bypass the old-event check, because it is the repair path.

## Reconciliation

`reconcileUser` asks Paystack for the subscription (`/subscription/:code` or `/subscription?customer=email`) and, when a reference is stored, verifies the transaction. It writes the remote state locally and stamps `last_reconciled_at`. It runs:

- On `GET /api/billing`, at most once every 10 minutes per subscriber. Free users with no subscription row are never queried.
- On demand from **Check payment** on `/account`, which forces a check.
- Daily from Vercel Cron at 03:00 (`/api/billing?action=reconcile`), for up to five subscriptions that have not been checked in the last hour.

Cron access requires `Authorization: Bearer $CRON_SECRET` (or `?secret=`). Set `CRON_SECRET` in Vercel Production so the daily sweep can run. Without it, the scheduled call has no session and does nothing; page-load and **Check payment** reconciliation still work for each signed-in person.

## Entitlement

`isEntitled()` treats `active`, `attention` (a failed renewal that Paystack is retrying), and `non-renewing` as paid while the paid period lasts, with a short grace window (1 day for active, 2 days for attention). A cancelled subscription keeps its plan until `current_period_end`, with no grace. The account card uses the same status to decide whether to show the upgrade choices or **Cancel renewal**. A new checkout is refused while a plan is still entitled, so a failed renewal cannot create a second subscription.

## Plans and listening limits

Every feature is visible on the free plan. The paid ones show a paywall with a way to upgrade, not a missing button.

| Feature | Free | Starter Pro | Power User | Enterprise |
| --- | --- | --- | --- | --- |
| Price | $0 | $7 / month (₦9,800) | $16 / month (₦22,400) | Per seat, invoiced |
| Listening | 100 minutes, lifetime | 10 hours a calendar month | 25 hours a calendar month | 1,000 hours a calendar month, shown as unlimited |
| Speaker labels | Every capture except a voice note | Same | Same | Same |
| Name boosting | Names and room words on every capture | Same | Same | Same, plus the organisation glossary |
| Notes, jottings, transcript, copy, Markdown, print | Yes | Yes | Yes | Yes |
| Share links | 1 live link per session, 7 days | 5 live links, up to 30 days | 5 live links, up to 30 days | 5 live links, up to 30 days |
| Branded PDF | Paywall | Yes | Yes | Yes |
| AI follow-up draft | Local draft from notes (paywall for AI) | Yes | Yes | Yes |
| Calendar and Jira | Paywall | Yes | Yes | Yes |
| Organisation Ask | Workspace and audit trail; Ask shows a paywall | Yes | Yes | Yes |
| Session ask and live decisions | Yes | Yes | Yes | Yes |

The legacy `pro` plan key is not sold any more. Anyone already paying $7 keeps 20 hours a month, more than the new Starter Pro allowance, and is never moved onto a new tier automatically.

The server enforces share limits (`server/api/limits.mjs`), the follow-up AI check, and the organisation Ask check. Client paywalls mirror those rules but are not trusted on their own.

## Listening limits

`GET /api/billing` returns a `usage` object with `usedSeconds`, `limitSeconds`, `remainingSeconds`, and the period. Free returns a lifetime window that starts at `users.free_allowance_started_at`; the migration sets that column to the rollout time for existing accounts, so every current user starts with a fresh 100 minutes rather than losing time already used this month. Starter Pro, Power User, and legacy Pro use the calendar month. Enterprise returns `unlimited: true` so the hidden 1,000-hour cap is not shown.

The limit is enforced in three places:

1. Before a capture or upload starts, the app checks the remaining time. At zero it explains the plan cap and links to `/account`.
2. While recording, the app counts the local elapsed time against the amount left. At zero it stops the recorder, keeps the audio and words heard so far, and writes the notes. Pausing cannot extend the allowance.
3. `POST /api/captures` checks the winning window with the server clock and refuses a capture that would pass the limit. Free counts from the lifetime start; paid plans count the calendar month. Clearing local data or calling the API directly does not bypass this. The capture stays in the local cache so it can sync after an upgrade.

The server counts every capture row, including live and failed rows, so abandoned recordings still use time. Deleting a capture does not refund its minutes: the `usage_ledger` row stays behind after the capture row is gone. Uploaded audio counts by its real duration.

### Enterprise plan

Enterprise seats are invoiced per seat outside Paystack. An operator turns the plan on and off with the same tool that issues onboarding links:

```bash
npm run enterprise:invite -- --activate cto@acme.com
npm run enterprise:invite -- --deactivate cto@acme.com
```

Activation writes a manual subscription row with `plan_key = enterprise` and `provider = manual`. It refuses to replace an active Paystack Pro subscription, so nobody is billed twice. Deactivation cancels that row and the account falls back to the free plan. The `JOTBOX_ENTERPRISE_MONTH_HOURS` value is the hidden ceiling; the app shows enterprise as unlimited.

## What listening costs

Scribe v3 reads every plan and both passes: the five-second live captions and the final full-recording pass. Scribe bills by audio duration at $0.20 per audio hour, so an hour of listening costs about $0.40 because the same audio is sent twice. A live segment that never rises above the speech gate is not sent, so a room with normal pauses costs less than this ceiling; the final pass still reads the whole file.

When the roster or the configured vocabulary gives Scribe names and room words to boost, the final pass adds $0.05 an hour, so a named hour costs about $0.45. Live captions stay unboosted: a five-second chunk cannot carry speaker ids, and adding keyterms to the live pass would raise every hour by another $0.05 for little gain. A session with no names at all stays at $0.40.

Speaker labels are requested on every capture except a voice note, on every plan, including free. Labels do not change the per-hour price; they only add speaker ids to the final pass.

| Session | Live plus final |
| --- | --- |
| 15 min | $0.11 |
| 30 min | $0.23 |
| 60 min | $0.45 |
| 90 min | $0.68 |
| 120 min | $0.90 |

| Monthly listening | Scribe cost |
| --- | --- |
| 5 h | $2.25 |
| 10 h | $4.50 |
| 20 h | $9.00 |
| 25 h | $11.25 |

These use the keyterms rate, the worst case where every hour carries names and room words. An hour with no names stays at $0.40.

After a 3.5% Paystack fee, Starter Pro leaves about $6.75 a month. Filling its 10-hour cap costs $4.50 in speech, so even the heaviest Starter month keeps about $2.25. Power User leaves about $15.44 and costs $11.25 at its 25-hour cap, keeping about $4.19.

The legacy $7 Pro plan is the only tier that runs at a planned loss: 20 hours costs about $9.00 against about $6.75 after fees, so the heaviest legacy month loses about $2.25. It breaks even at about 15 hours. That plan is closed to new subscribers, and it is the cost of not cutting anyone's allowance.

A realistic mix is far below either cap. Take Starter users averaging 3 hours and Power users averaging 8 hours: that is about $1.35 and $3.60 in speech, leaving most of each payment. The cap sets the worst case, not the expected cost.

Prices are public list prices at the time of writing; confirm them in the ElevenLabs console before relying on them.

### Free tier carries the cost of the demo

Free gets the same Scribe reader because the free experience is the pitch. The allowance is 100 minutes for the life of the account, so a free user who uses all of it costs at most about $0.75 with names boosted, once. That spend is accepted as acquisition cost. A short first session costs a few cents, which is the point: the person hears the real accuracy before deciding to pay.

The free cap is enforced by the app and the server, not by the provider, so clearing local data does not move a free user onto a paid plan.

### Fallbacks and capacity

Scribe is the only path while `ELEVENLABS_API_KEY` is set. The fallbacks exist for a server without the key:

- `WHISPER_BASE_URL` runs the self-hosted reader when Scribe is not configured, with no per-hour provider bill.
- `GROQ_API_KEY` is the Groq fallback. Its free-plan quotas (20 requests a minute, 2,000 a day, 2 audio-hours an hour, 8 audio-hours a day per model) only matter on such a server. At chunks averaging about five seconds one live session sends about 12 requests a minute.
- `XAI_API_KEY` and the demo reader run after those.

`JOTBOX_STT_PROVIDER` pins the fallback order for a provider benchmark. It never changes the plan rules: every plan gets the same labels and name boosting, and only a voice note skips labels.

### Levers that move the number further

- **Live chunk size.** Segments target five seconds and close at the next gap in speech, up to a 6.2 second cap, so captions stay close to the room without slicing words on a fixed grid. Longer chunks cut request count but make lines arrive later; the final pass still rebuilds the transcript from the full audio.
- **Silence gate.** Each live segment is sampled from the same analyser that drives the level meter. If the loudest sample in the segment stays below `LIVE_SPEECH_RMS` (0.012 of full scale), the segment is dropped before it reaches Scribe, which saves both audio seconds and a request. Peak level decides, not the average, so one soft word in five quiet seconds still goes through. The final pass is unaffected and still reads the full recording.
- **Retries.** A retry on a session that already has words rebuilds the notes only, with no new audio read. Only a retry with no words at all sends the saved file through the final pass again.
- **Self-hosted worker.** `WHISPER_BASE_URL` can carry long or heavy recordings at flat cost, but the router currently prefers Scribe whenever it is configured.
- **Plan caps.** Starter Pro is 10 hours, Power User 25, and legacy Pro 20. Each is hard, reserved before a recording starts and settled on save, so a heavy user cannot erode the margin beyond the planned subsidy. `JOTBOX_STARTER_MONTH_HOURS`, `JOTBOX_POWER_MONTH_HOURS`, and `JOTBOX_PRO_MONTH_HOURS` can raise or lower them.

