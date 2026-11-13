# Payments and Pro subscriptions

JotBox uses Paystack for Pro. The site shows **$7 a month**, and checkout charges the Naira equivalent because a Paystack plan is locked to one currency. Nigerian cards are charged in Naira by JotBox itself, not converted silently by Paystack.

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
| `PAYSTACK_PLAN_CODE` | Optional. Use an existing monthly NGN plan instead of letting JotBox create and cache one. |
| `PAYSTACK_PRO_AMOUNT_NGN` | Naira charged each month. Defaults to `$7 × JOTBOX_USD_TO_NGN`. |
| `JOTBOX_USD_TO_NGN` | Display and fallback conversion rate. Defaults to `1600`. |
| `JOTBOX_FREE_MONTH_MINUTES` | Free listening each calendar month. Defaults to `60`; Pro is unlimited. |
| `JOTBOX_PUBLIC_URL` | Public origin used for the Paystack callback. Falls back to the request host. |
| `CRON_SECRET` | Bearer token Vercel Cron sends to the daily payment check. Generate a long random string. |

Never add the secret key to a `VITE_` variable, and never commit `.env`. Add the same names to Vercel Production, Preview, and Development as sensitive values.

## Paystack dashboard

1. Copy the secret key from **Settings, API Keys and Webhooks**.
2. Set the webhook URL to `https://your-domain/api/billing`.
3. Test with a test secret key first. Paystack test payments use test cards and do not move money.
4. Switch to the live secret key, then make one small live payment and confirm the webhook arrives before announcing Pro.

JotBox creates a plan named `JotBox Pro NGN <amount> monthly` the first time someone upgrades. The plan code is cached in `billing_plans`; changing `PAYSTACK_PRO_AMOUNT_NGN` creates a new plan on the next checkout so existing subscribers keep their old price.

## Database

`db/schema.sql` adds five tables:

- `billing_plans`: the cached Paystack plan code for Pro.
- `billing_subscriptions`: one row per person, with status, amount, the current paid period, and the Paystack subscription and email tokens.
- `billing_checkouts`: one row per checkout attempt, keyed by the Paystack reference. It also stores the client `Idempotency-Key` so a retried request cannot open a second payment.
- `billing_transactions`: the local money ledger, keyed by `(provider, reference)`. A reference can only be applied once, and `applied_at` records that it was.
- `billing_events`: webhook receipts keyed by event id, used for idempotency, with the user it touched and whether it applied.

Migration `005_usage_metering` adds `captures.recorded_at`, a server-set timestamp used to count listening minutes per calendar month. A client cannot move usage into another month by editing `created_at`.

Migration `006_billing_hardening` adds the paid period (`current_period_start`, `current_period_end`), event ordering (`last_event_at`, `last_event_id`), reconciliation stamps, and the two new tables.

Run `npm run db:migrate` after pulling this change.

## A payment can only count once

Every checkout gets a server-made reference, `jotbox_<uuid>`. That reference is the primary key of `billing_checkouts` and part of the key for `billing_transactions`. The browser return (`action=verify`) and the Paystack webhook both go through `recordTransaction`, which inserts on that key. The second write updates the row and reports `needs_apply = false`, so a retry, a refresh, or a second tab cannot buy a second month.

Checkout is idempotent in three ways:

1. The client sends an `Idempotency-Key` header. The same key returns the same open checkout.
2. A user can only have one live checkout (`creating` or `open`). An abandoned attempt is cleaned up after 90 seconds (`creating`) or 30 minutes (`open`).
3. At most 12 checkout attempts are allowed per user per hour.

## Plans cannot be extended from outside

`validProCharge` refuses to grant Pro unless the charge is in Naira, at least 90 percent of the agreed amount (or the amount the subscriber already pays), and tied to the JotBox Pro plan code or metadata. A valid reference for a cheaper transaction is not enough.

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

## Free and Pro

Every feature is visible on the free plan. The paid ones show a paywall with a way to upgrade, not a missing button.

| Feature | Free | Pro |
| --- | --- | --- |
| Listening | 60 minutes a calendar month | Unlimited |
| Notes, jottings, transcript, copy, Markdown, print | Yes | Yes |
| Share links | 1 live link per session, 7 days | 5 live links, up to 30 days |
| Branded PDF | Paywall | Yes |
| AI follow-up draft | Local draft from notes (paywall for AI) | Yes |
| Organisation Ask | Workspace and audit trail; Ask shows a paywall | Yes |
| Session ask and live decisions | Yes | Yes |

The server enforces share limits (`server/api/limits.mjs`), the follow-up AI check, and the organisation Ask check. Client paywalls mirror those rules but are not trusted on their own.

## Free listening limit

`GET /api/billing` returns a `usage` object with `usedSeconds`, `limitSeconds`, `remainingSeconds`, and the calendar-month period. Pro returns `unlimited: true`.

The limit is enforced in three places:

1. Before a capture or upload starts, the app checks the remaining time. At zero it explains the cap and links to `/account`.
2. While recording, the app counts the local elapsed time against the amount left. At zero it stops the recorder, keeps the audio and words heard so far, and writes the notes. Pausing cannot extend the allowance.
3. `POST /api/captures` checks the month's usage with the server clock and refuses a free capture that would pass the limit. Clearing local data or calling the API directly does not bypass this. The capture stays in the local cache so it can sync after an upgrade.

The server counts every capture row, including live and failed rows, so abandoned recordings still use time. Deleting a capture removes its minutes, because the notes are deleted with it. Uploaded audio counts by its real duration.
