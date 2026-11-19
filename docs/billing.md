# Payments and Pro subscriptions

JotBox uses Paystack for Pro. The site shows **$5 a month**, and checkout charges the Naira equivalent because a Paystack plan is locked to one currency. Nigerian cards are charged in Naira by JotBox itself, not converted silently by Paystack.

## How the flow works

1. A signed-in person chooses **Upgrade to Pro** on `/account`.
2. `POST /api/billing?action=checkout` finds or creates the monthly NGN plan, then asks Paystack for a checkout link.
3. Paystack returns the person to `/account?billing=callback&reference=...`.
4. The app calls `POST /api/billing?action=verify`, and the server confirms the reference with Paystack before marking Pro active.
5. Paystack also posts events to `POST /api/billing`. The webhook is checked with the `x-paystack-signature` HMAC before anything is saved, and event ids are stored so retries cannot apply twice.
6. **Cancel renewal** calls Paystack's disable endpoint. Pro stays on until the paid period ends, and the plan does not renew.

The status card on `/account` reads `GET /api/billing`. Every billing action requires the httpOnly JotBox session.

## Environment

| Name | Purpose |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Server-only key. `sk_test_...` while testing, `sk_live_...` in production. |
| `PAYSTACK_PLAN_CODE` | Optional. Use an existing monthly NGN plan instead of letting JotBox create and cache one. It must match the current amount, currency, and interval, or checkout refuses to start. |
| `PAYSTACK_PRO_AMOUNT_NGN` | Naira charged each month. Defaults to `$5 × JOTBOX_USD_TO_NGN`, which is 8,000 Naira. |
| `JOTBOX_USD_TO_NGN` | Display and fallback conversion rate. Defaults to `1600`. |
| `JOTBOX_FREE_MONTH_MINUTES` | Free listening each calendar month. Defaults to `60`. |
| `JOTBOX_PRO_MONTH_HOURS` | Pro listening each calendar month. Defaults to `30`. |
| `JOTBOX_ENTERPRISE_MONTH_HOURS` | Hidden enterprise listening cap each calendar month. Defaults to `1000`; the app shows enterprise as unlimited. |
| `JOTBOX_PUBLIC_URL` | Public origin used for the Paystack callback. Falls back to the request host. |
| `CRON_SECRET` | Bearer token Vercel Cron sends to the daily payment check. Generate a long random string. |

Never add the secret key to a `VITE_` variable, and never commit `.env`. Add the same names to Vercel Production, Preview, and Development as sensitive values. The public key is not used: checkout is a server-created redirect, so only the secret key matters.

In Vercel Production, `PAYSTACK_SECRET_KEY` must start with `sk_live_`. The server refuses every billing call in production while a test key is set.

## Going live

1. Copy the live secret key from **Settings, API Keys and Webhooks** in the Paystack dashboard and save it as `PAYSTACK_SECRET_KEY` in Vercel Production (sensitive). Redeploy afterwards so the function picks it up.
2. Set `PAYSTACK_PRO_AMOUNT_NGN=8000` (5 dollars at the 1,600 rate) and `JOTBOX_PUBLIC_URL=https://your-domain`.
3. In live mode, set the webhook URL to `https://your-domain/api/billing`.
4. Keep `PAYSTACK_PLAN_CODE` empty unless you created a live monthly NGN plan. A test-mode plan code does not exist in live mode, and checkout will fail on it.
5. Make one small live payment with a real card, confirm Pro turns on, the webhook appears in the Paystack dashboard, and **Cancel renewal** works. Then refund it.

Plans belong to one mode. A plan created with a test key cannot be used with a live key. JotBox checks the stored plan against the live API and creates a fresh one when the cached code is dead or the price changed, so the switch from test to live heals itself on the first checkout.

JotBox creates a plan named `JotBox Pro NGN <amount> monthly` the first time someone upgrades. The plan code is cached in `billing_plans`; changing `PAYSTACK_PRO_AMOUNT_NGN` creates a new plan on the next checkout so existing subscribers keep their old price.

## Database

`db/schema.sql` adds five tables:

- `billing_plans`: the cached Paystack plan code for Pro.
- `billing_subscriptions`: one row per person, with status, amount, the current paid period, and the Paystack subscription and email tokens.
- `billing_checkouts`: one row per checkout attempt, keyed by the Paystack reference. It also stores the client `Idempotency-Key` so a retried request cannot open a second payment.
- `billing_transactions`: the local money ledger, keyed by `(provider, reference)`. A reference can only be applied once, and `applied_at` records that it was.
- `billing_events`: webhook receipts keyed by event id, used for idempotency, with the user it touched and whether it applied.

Migration `005_usage_metering` adds `captures.recorded_at`, a server-set timestamp used to count listening minutes per calendar month. A client cannot move usage into another month by editing `created_at`.

Migration `007_usage_ledger` moves the meter into `usage_ledger`, keyed by `(user_id, capture_id)`. Each saved capture writes its longest known duration in the same transaction as the capture row, behind a per-user advisory lock. Existing captures are backfilled once. Deleting a capture leaves its ledger row in place, so consumed minutes are never refunded.

Migration `006_billing_hardening` adds the paid period (`current_period_start`, `current_period_end`), event ordering (`last_event_at`, `last_event_id`), reconciliation stamps, and the two new tables.

Run `npm run db:migrate` after pulling this change.

## A payment can only count once

Every checkout gets a server-made reference, `jotbox_<uuid>`. That reference is the primary key of `billing_checkouts` and part of the key for `billing_transactions`. The browser return (`action=verify`) and the Paystack webhook both go through `recordTransaction`, which inserts on that key. The second write updates the row and reports `needs_apply = false`, so a retry, a refresh, or a second tab cannot buy a second month.

Checkout is idempotent in three ways:

1. The client sends an `Idempotency-Key` header. The same key returns the same open checkout.
2. A user can only have one live checkout (`creating` or `open`). An abandoned attempt is cleaned up after 90 seconds (`creating`) or 30 minutes (`open`).
3. At most 12 checkout attempts are allowed per user per hour.

## Plans cannot be extended from outside

`validProCharge` refuses to grant Pro unless the charge is in Naira, for exactly the amount quoted when that checkout was opened (or the amount the subscriber already pays), and tied to the JotBox Pro plan code or metadata. A valid reference for a cheaper transaction is not enough, and rounding tricks do not pass.

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

`isEntitled()` treats `active`, `attention` (a failed renewal that Paystack is retrying), and `non-renewing` as Pro while the paid period lasts, with a short grace window (1 day for active, 2 days for attention). A cancelled subscription keeps Pro until `current_period_end`, with no grace. The account card uses the same status to decide whether to show **Upgrade to Pro** or **Cancel renewal**. A new checkout is refused while a plan is still entitled, so a failed renewal cannot create a second subscription.

## Plans and listening limits

Every feature is visible on the free plan. The paid ones show a paywall with a way to upgrade, not a missing button.

| Feature | Free | Pro | Enterprise |
| --- | --- | --- | --- |
| Listening | 100 minutes a calendar month | 25 hours a calendar month | 1,000 hours a calendar month, shown as unlimited |
| Notes, jottings, transcript, copy, Markdown, print | Yes | Yes | Yes |
| Share links | 1 live link per session, 7 days | 5 live links, up to 30 days | 5 live links, up to 30 days |
| Branded PDF | Paywall | Yes | Yes |
| AI follow-up draft | Local draft from notes (paywall for AI) | Yes | Yes |
| Organisation Ask | Workspace and audit trail; Ask shows a paywall | Yes | Yes |
| Session ask and live decisions | Yes | Yes | Yes |

The server enforces share limits (`server/api/limits.mjs`), the follow-up AI check, and the organisation Ask check. Client paywalls mirror those rules but are not trusted on their own.

## Listening limits

`GET /api/billing` returns a `usage` object with `usedSeconds`, `limitSeconds`, `remainingSeconds`, and the calendar-month period. Free and Pro return their real limit. Enterprise returns `unlimited: true` so the hidden 1,000-hour cap is not shown.

The limit is enforced in three places:

1. Before a capture or upload starts, the app checks the remaining time. At zero it explains the plan cap and links to `/account`.
2. While recording, the app counts the local elapsed time against the amount left. At zero it stops the recorder, keeps the audio and words heard so far, and writes the notes. Pausing cannot extend the allowance.
3. `POST /api/captures` checks the month's usage with the server clock and refuses a capture that would pass the limit. Clearing local data or calling the API directly does not bypass this. The capture stays in the local cache so it can sync after an upgrade.

The server counts every capture row, including live and failed rows, so abandoned recordings still use time. Deleting a capture does not refund its minutes: the `usage_ledger` row stays behind after the capture row is gone. Uploaded audio counts by its real duration.

### Enterprise plan

Enterprise seats are invoiced per seat outside Paystack. An operator turns the plan on and off with the same tool that issues onboarding links:

```bash
npm run enterprise:invite -- --activate cto@acme.com
npm run enterprise:invite -- --deactivate cto@acme.com
```

Activation writes a manual subscription row with `plan_key = enterprise` and `provider = manual`. It refuses to replace an active Paystack Pro subscription, so nobody is billed twice. Deactivation cancels that row and the account falls back to the free plan. The `JOTBOX_ENTERPRISE_MONTH_HOURS` value is the hidden ceiling; the app shows enterprise as unlimited.

## What listening costs

Groq bills speech by audio duration, not by request. `whisper-large-v3` costs $0.111 per audio hour and `whisper-large-v3-turbo` costs $0.04. Live captions and the final transcript both send the same audio, so a recorded session normally costs two passes. The kept transcript is always rebuilt from the full-audio pass, so live previews now use turbo through `GROQ_LIVE_STT_MODEL` while the final pass stays on `GROQ_STT_MODEL` (`whisper-large-v3`).

When `ELEVENLABS_API_KEY` is set, Scribe v3 replaces the final Groq pass and adds diarisation. Scribe is billed at about $0.20 per audio hour, so a recorded hour costs about $0.24 with Groq turbo previews, against $0.151 on Groq alone. That difference sets the Pro cap: at 25 hours of full use, Scribe plus live previews costs about $6.00, so a maximally heavy Pro user costs about $1.00 more than the $5 plan earns. The tables below assume Groq is the final pass; swap the large-v3 column for $0.20 an hour when Scribe is on.

Prices and limits below are as published at the time of writing; confirm them in the Groq console before relying on them.

| Session | Both passes on large-v3 | Now: live turbo, final large-v3 |
| --- | --- | --- |
| 15 min | $0.056 | $0.038 |
| 30 min | $0.111 | $0.075 |
| 60 min | $0.222 | $0.151 |
| 90 min | $0.333 | $0.227 |
| 120 min | $0.444 | $0.302 |

Per 1,000 session-hours the change takes speech cost from $222 to $151, about 32% lower.

On a $5 Pro plan, the break-even point on speech alone moves from 22.5 hours to 33.1 hours a month.

| Monthly listening | Both passes on large-v3 | Now |
| --- | --- | --- |
| 5 h | $1.11 | $0.76 |
| 10 h | $2.22 | $1.51 |
| 20 h | $4.44 | $3.02 |
| 25 h | $5.55 | $3.78 |
| 30 h | $6.66 | $4.53 |
| 40 h | $8.88 | $6.04 |

At 25 hours a month with Groq as the final pass, Pro leaves $1.22 before payment fees. With Scribe as the final pass, 25 hours costs about $6.00, so the cap holds the worst case to about $1.00 above the plan instead of $2.20 at the old 30-hour limit. A user who talks for 40 hours is refused before the spend happens.

### Free tier limits

Groq's free plan allows, per organization and per model: 20 requests a minute, 2,000 requests a day, 7,200 audio-seconds an hour (2 audio-hours) and 28,800 audio-seconds a day (8 audio-hours). Live chunks are 10 seconds, so one live session makes six requests a minute.

Because live previews and the final pass now hit different models, the free daily allowance roughly doubles:

| Session length | Sessions a day before | Sessions a day now |
| --- | --- | --- |
| 15 min | 16.0 | 22.2 |
| 30 min | 8.0 | 11.1 |
| 60 min | 4.0 | 5.6 |
| 90 min | 2.7 | 3.7 |
| 120 min | 2.0 | 2.8 |

At 60 minutes the binding limit is now the 2,000 live requests a day, not audio time. A single always-on recording with live captions uses 2 audio-hours an hour, which fills the free hourly audio cap by itself. After the split, two can run at once: sustained concurrency goes from 1 to 2.

### Dev tier

The Dev tier raises throughput to roughly 200,000 audio-seconds an hour for large-v3 and 400,000 for turbo, with higher request limits. Sustained concurrent recordings go from 27.8 to 55.6 for the same speech spend. The exact request caps should be confirmed in the console.

### Levers that move the number further

- **Live chunk size.** 10-second chunks create the requests-a-day ceiling on free. 20-second chunks would roughly double free daily sessions, at the cost of caption latency.
- **Silence gate.** The capture already computes an RMS level for the meter. Skipping silent chunks would cut both audio seconds and requests.
- **Retries.** A failed notes build retries with a fresh full-audio pass, which costs another final transcription. Note rewrites do not re-transcribe.
- **Self-hosted worker.** `WHISPER_BASE_URL` moves long or heavy recordings to a flat-cost worker and away from Groq metering.
- **Pro cap.** At 25 hours a month Pro clears $1.22 on Groq and holds the Scribe worst case near $1.00 above the plan. The cap is hard, reserved before a recording starts and settled on save, so a heavy user cannot erode the margin. `JOTBOX_PRO_MONTH_HOURS` can raise it if costs fall.

