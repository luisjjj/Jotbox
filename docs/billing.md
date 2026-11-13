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
| `JOTBOX_PUBLIC_URL` | Public origin used for the Paystack callback. Falls back to the request host. |

Never add the secret key to a `VITE_` variable, and never commit `.env`. Add the same names to Vercel Production, Preview, and Development as sensitive values.

## Paystack dashboard

1. Copy the secret key from **Settings, API Keys and Webhooks**.
2. Set the webhook URL to `https://your-domain/api/billing`.
3. Test with a test secret key first. Paystack test payments use test cards and do not move money.
4. Switch to the live secret key, then make one small live payment and confirm the webhook arrives before announcing Pro.

JotBox creates a plan named `JotBox Pro NGN <amount> monthly` the first time someone upgrades. The plan code is cached in `billing_plans`; changing `PAYSTACK_PRO_AMOUNT_NGN` creates a new plan on the next checkout so existing subscribers keep their old price.

## Database

`db/schema.sql` adds three tables:

- `billing_plans`: the cached Paystack plan code for Pro.
- `billing_subscriptions`: one row per person, with status, amount, next payment date, and the Paystack subscription and email tokens.
- `billing_events`: webhook receipts keyed by event id, used for idempotency.

Run `npm run db:migrate` after pulling this change.

## Entitlement

`isEntitled()` treats `active`, `attention` (a failed renewal that Paystack is retrying), and `non-renewing` as Pro. A cancelled subscription keeps Pro until `next_payment_at`. The account card uses the same status to decide whether to show **Upgrade to Pro** or **Cancel renewal**. A new checkout is refused while a plan is still entitled, so a failed renewal cannot create a second subscription.

The free listening limit is not enforced in this change. The plan status is recorded and shown, so gating can be added without changing the payment flow.
