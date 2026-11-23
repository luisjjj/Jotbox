# Implicit state machines and transition inventory

JotBox has no formal state-machine library. State lives in React refs and
`useState`, Zustand stores, Postgres status columns, Electron window flags and
IPC messages. This document lists every stateful subsystem, the events that
move it, and the transitions that are currently missing or unsafe.

Use it as a review checklist. When a change touches one of these areas, check
the transition tables before shipping.

## How to read this

- **States** are the exact values in code or in the database.
- **Events** include user actions, timers, network results, page lifecycle,
  webhooks and IPC messages.
- **Guards** are the checks that decide whether a transition is allowed.
- **Gaps** are transitions that are impossible, double-fire, dead-end or race.
- Severity: **P1** can lose money, data or access; **P2** can strand a user or
  show the wrong state; **P3** is cosmetic or a missing test.

## Machine index

| # | Machine | States | Primary evidence |
| --- | --- | --- | --- |
| 1 | Recording engine | idle, recording, paused, processing | `apps/web/src/engine/SessionEngine.tsx:32` |
| 2 | Persisted capture | live, processing, ready, failed | `apps/web/src/lib/types.ts:33`, `server/api/captures.mjs:70` |
| 3 | Upload and import | idle, processing, ready, failed | `SessionEngine.tsx:694`, `pages/Listen.tsx:232` |
| 4 | Notes pipeline | transcript, filter, notes, fallback | `apps/web/src/lib/buildNotes.ts:144` |
| 5 | Live insights | merge, throttle, request, discard | `SessionEngine.tsx:883` |
| 6 | Pre-meeting brief | idle, loading, done, open | `components/PreMeetingBrief.tsx:10` |
| 7 | Session ask | idle, busy, answered | `components/SessionAsk.tsx:9` |
| 8 | Captions and audio | unavailable, live, ended | `SessionEngine.tsx:397`, `components/TranscriptView.tsx` |
| 9 | Auth session | loading, signed in, signed out | `auth/AuthProvider.tsx:18` |
| 10 | Checkout attempt | creating, open, paid, failed, expired | `db/schema.sql:245` |
| 11 | Payment ledger | pending, applied, ignored | `server/api/billing.mjs:287` |
| 12 | Subscription | active, attention, non-renewing, cancelled, completed | `db/schema.sql:174` |
| 13 | Cancellation and reconciliation | fresh, stale, cancelled | `server/api/billing.mjs:767`, `:817` |
| 14 | Usage quota | unknown, free within limit, free exhausted, pro | `lib/usageStore.ts:23` |
| 15 | Paywall and plan intent | closed, open, pending plan, consumed | `components/Paywall.tsx:17`, `pages/Account.tsx:115` |
| 16 | Share link | active, expired, revoked, deleted | `db/schema.sql:139`, `server/api/share.mjs:47` |
| 17 | Share dialog | closed, loading, idle, creating, created, error, paywall | `components/ShareDialog.tsx:29` |
| 18 | Org membership and role | owner, admin, manager, member, absent | `server/api/orgs.mjs:441` |
| 19 | Capture visibility and grants | private, department, organisation, granted | `server/api/orgs.mjs:607` |
| 20 | Org memory ask | idle, asking, answered, error | `pages/Memory.tsx:479`, `server/api/orgs.mjs:850` |
| 21 | Cloud sync | off, syncing, ready, error | `lib/syncStore.ts:3`, `components/CloudSync.tsx:34` |
| 22 | Desktop island | hidden, shown, interactive, ignored, collapsed, expanded | `apps/desktop/main.cjs:427`, `pages/IslandPage.tsx:109` |
| 23 | Desktop picker, hotkey, splash, tray | closed, open, picked, cancelled | `apps/desktop/main.cjs:175`, `:268`, `:410` |
| 24 | Audio retention | keep, 7, 30, 90 days | `lib/retention.ts:5` |
| 25 | Delete confirmation | closed, confirming, deleting | `pages/SessionPage.tsx:247` |
| 26 | Password reset | none, requested, used, expired, revoked-by-new-request | `server/api/auth.mjs:226`, `:262`, `db/schema.sql:353` |
| 27 | Enterprise invite | created, opened, accepted, expired, revoked | `scripts/enterprise-invite.mjs`, `server/api/onboarding.mjs:83`, `db/schema.sql:367` |
| 28 | Connected apps and Jira handoff | disconnected, connecting, connected, needs-reconnect; none, sent, existing | `server/api/integrations.mjs:490`, `:828`, `db/schema.sql:398` |

## Cross-machine events

These events move more than one machine. Most serious bugs live at these seams.

| Event | Machines touched | Expected outcome |
| --- | --- | --- |
| Start recording | 1, 2, 14 | Guard engine idle, check quota, create live capture |
| Stop recording | 1, 2, 4, 14, 21 | Flush audio, transcribe, write notes, refresh usage, mark dirty |
| Free minutes hit zero | 1, 14 | Stop recorder, keep audio and words, notes still write |
| Capture save returns 402 | 2, 14, 21 | Keep local copy, park sync, refresh usage, show upgrade path |
| Auth cookie expires | 9, 21 | Every API returns 401; app should move to signed out |
| Sign out | 9, 21, 24 | Flush or preserve unsynced work, stop sync, clear cache, prune audio |
| Upgrade to Pro | 10, 11, 12, 14, 15 | Checkout, verify, entitlement, 20 hours a month, clear paywalls |
| Renewal fails | 12, 14, 21 | Attention status, grace window, then free |
| Cancel renewal | 12, 13 | Keep Pro to period end, stop future charges |
| Revoke share link | 16, 17 | Row revoked, public page 410, open tabs stale |
| Remove org member | 18, 19, 21 | Access predicate changes immediately, local panels stale |
| Close browser mid-capture | 1, 2 | Next boot marks live capture failed, not ready |
| Desktop toggle hotkey | 1, 22, 23 | Same engine guard as clicking Start |
| Forgot password | 26, 9 | Old unused tokens retired, new token emailed, generic response either way |
| Reset password | 26, 9 | Token marked used, password replaced, every auth session deleted |
| Open enterprise invite | 27 | Hash checked, `opened_at` touched, expired or revoked returns 404 |
| Accept enterprise invite | 27, 9 | Signed-in user recorded, `accepted_at` set once, checklist preserved |
| Connect a calendar or Jira | 28, 9 | Pro and signed-in only, single-use state survives the provider round trip |
| Send actions to Jira | 28, 2 | Only open actions from a ready capture, one row per action, retries return the existing key |

## 1. Recording engine

**States:** `idle`, `recording`, `paused`, `processing`
(`SessionEngine.tsx:32`, `:171`).

| From | Event | To | Guards and effects |
| --- | --- | --- | --- |
| idle | Start mic or tab | recording | Quota check, open stream, MediaRecorder start, create live capture |
| idle | Start with no minutes | idle | `FREE_LIMIT_ERROR`, no stream created |
| idle | Mic permission denied | idle | Stream closed, mapped error message |
| recording | Pause | paused | Freeze elapsed, pause recorder, stop speech |
| paused | Resume | recording | Re-check free minutes, resume recorder and speech |
| paused | Resume with no minutes | paused | Toast, no state change |
| recording | Stop, 4 hour timer, free limit, tab ended, desktop stop | processing | Close PiP, flush recorder, save audio, navigate to session |
| paused | Stop, tab ended, desktop stop | processing | Same as above |
| processing | Notes written | idle | Capture ready, engine reset |
| processing | Notes failed | idle | Capture failed with error, engine reset |
| recording, paused, processing | Second Start or import | unchanged | "Finish the current session first." |
| processing | Page closed | processing on disk | Next boot marks it failed |

**Resolved**

- A synchronous `startingRef` is set before the first await and cleared when the
  engine reaches `recording` or returns (`SessionEngine.tsx:189`), so a second
  click or desktop command cannot open a second stream.
- `buildNotes` runs behind a six minute watchdog (`lib/processing.ts`). A
  capture that never settles becomes `failed` with the audio still saved.

**Gaps**

- **P2, stop is optimistic in callers.** `stop()` silently returns unless the
  state is recording or paused (`:490`) and an id exists (`:492`), but callers
  toast "Writing your notes" unconditionally. Return a result and toast from it.
- **P2, paused sessions escape the free timer.** The allowance timer checks
  only `recording` (`:993`). A paused session can sit past the monthly limit.
- **P3, boot only closes live rows once.** `closeLiveSession` runs on engine
  mount (`:946`). A live row pulled from another tab later is not closed until
  the next cloud pull.

## 2. Persisted capture

**States:** `live`, `processing`, `ready`, `failed`
(`apps/web/src/lib/types.ts:33`; server sweep at `captures.mjs:70`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| none | Start | live | Created with `hasAudio: false` |
| live | Scratch, title or insights edit | live | Debounced local write and sync dirty |
| live | Stop | processing | Transcript preserved, notes cleared |
| processing | Notes resolve | ready | Title, transcript and notes written |
| processing | Notes reject | failed | Error stored |
| processing | Boot sees stale processing | failed | "Still being written when the page closed" |
| live | Boot or cloud pull sees stale live | failed | Interrupted or expired error |
| failed or ready | Retry or regenerate | ready | Direct patch, no processing state |
| failed or ready | Save transcript | ready | Patch and regenerate |
| any | Delete | absent | Row removed, local audio deleted when possible |

**Gaps**

- **P1, last-writer-wins.** Regenerate, retry and save transcript patch `ready`
  directly (`SessionPage.tsx:336`, `:385`, `:407`) while a stop or import job
  can still finish and overwrite title, transcript and notes
  (`SessionEngine.tsx:543`). Add a revision or updated-at guard to the patch.
- **P2, delete during recording resurrects.** Delete removes the row, but a
  later debounced `upsert` re-inserts it (`store.ts:21`). Stop the engine or
  block delete while the id is live.
- **P2, ready with no notes.** `stop()` marks ready whenever notes resolve,
  even if both notes and transcript are empty. The row shows no status chip and
  the page shows the empty state.
- **P3, retry skips processing.** There is no visible writing state and no
  way to cancel a second regenerate.

## 3. Upload and import

**States:** engine `processing` plus component flags `uploading` and
`busy: "mic" | "tab" | null` (`Listen.tsx:232`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| idle | Valid file picked | processing | Usage check, duration probe, engine import |
| idle | File too large or too long | idle | Toast, no capture |
| idle | Usage exhausted | idle | Toast or paywall |
| processing | Studio notes succeed | ready | Capture ready |
| processing | Studio off, empty result or throw | failed | Error stored |
| processing | File read fails | idle | Toast, no capture |
| processing | Second import or mic start during precheck | unchanged | `startingRef` blocks it |

**Resolved:** import takes the same synchronous `startingRef` guard before the
usage check and duration probe, and the notes call runs behind the same six
minute watchdog.

**Gaps**

- **P3, cancel is impossible.** The 90 second notes call has no user cancel.

## 4. Notes pipeline

This is a pipeline, not a state machine. It has ordered stages with timeouts
(`buildNotes.ts:144`):

1. Optional transcription (`:164`).
2. Line filtering (`:178`).
3. Hard failure only when the read failed and no lines or scratch exist
   (`:180`).
4. Optional studio notes (`:186`).
5. Local fallback (`:201`).

The caller owns `processing -> ready | failed`. There is no retry inside the
pipeline and no observable intermediate state. Do not add a second state
machine here. Add the watchdog at the engine level instead.

## 5. Live insights

Encoded in refs, not states: `insightBusy`, `insightAt`, `insightCount`
(`SessionEngine.tsx:211`).

| From | Event | To |
| --- | --- | --- |
| idle | Transcript reaches 4 lines or 60 seconds | busy |
| busy | Request resolves for the same capture | idle, merge |
| busy | Request resolves after stop | idle, discard |
| busy | Request rejects | idle, discard |
| any | New capture | counters reset |

**Gap, P3:** throttle counters advance even when a result is discarded, and
there is no abort. `requestInsights` never rejects (`insights.ts:73`), so there
is no visible failed state.

## 6. Pre-meeting brief

**States:** `idle`, `loading`, `done` plus `open`
(`PreMeetingBrief.tsx:10`, `:27`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| idle | Open with a previous capture | loading | Request id recorded |
| loading | Response for current id | done | AI or local source |
| loading | Capture changes | idle | Stale response ignored |
| done | Close | done, closed | Modal hidden |
| done | Start listening | done, closed | Caller starts capture |
| idle | Open after reset | idle, open | Blank body |

**Gaps**

- **P2, blank dialog.** `idle` has no rendered branch (`:89`). Finishing
  another capture while the modal is open resets it to idle and blanks the body.
- **P3, no error state.** Network failure is folded into `done` with the local
  brief. The user cannot tell the AI failed.

## 7. Session ask

`turns`, `question`, `busy` (`SessionAsk.tsx:9`). This is a flag, not a real
state machine.

| From | Event | To | Effects |
| --- | --- | --- | --- |
| idle | Submit or quick chip | busy | Append user turn, await answer |
| busy | Answer resolves | idle | Append assistant turn |
| busy | Second submit in same tick | busy | Both calls may pass the guard |
| busy | Request hangs | busy forever | No timeout |

**Gaps, P2:** double-submit is possible because `busy` is read from a closure
and the disabled attribute is not a guard. Add a ref guard and a timeout.

## 8. Captions and audio micro-states

- **Captions:** available, then permanently unavailable on missing API,
  permission or network failure (`SessionEngine.tsx:397`, `:439`). It never
  returns to available in the same session. Acceptable, but label it clearly.
- **Audio URL:** unknown, loading, available, missing. All failures collapse to
  `null`. There is no error state.
- **Audio player:** playing and paused, reset on source change. A rejected
  `play()` is ignored.

## 9. Auth session

**Client states:** `loading`, signed in, signed out
(`AuthProvider.tsx:18`). **Server states:** session valid, expired, deleted
(`auth.mjs:22`). Password hashes use scrypt; the cookie is HttpOnly and same
site (`auth.mjs:79`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| loading | `/api/auth/me` returns user | signed in | Unsuspend cloud sync |
| loading | `/api/auth/me` returns null or errors | signed out | Sync stays suspended |
| signed out | Register success | signed in | User set, cookie issued, navigate next |
| signed out | Login success | signed in | User set, cookie issued, navigate next |
| signed in | Sign out | signed out | Flush, suspend, logout, clear sessions, reset sync |
| signed in | Cookie expires | signed in on screen | API calls return 401, no store transition |
| signed in | Boot me resolves late after login | signed in or signed out | Race can overwrite the new user |

**Gaps**

- **P1, 401 never signs the client out.** `request()` throws `ApiError(401)`
  (`api.ts:239`) but no caller transitions auth. The UI stays signed in while
  every write fails.
- **P1, sign-out can delete unsynced work.** The comment says unsent edits stay
  cached, but `useSessions.clear()` runs unconditionally after a failed flush
  (`AuthProvider.tsx:59`, `:69`). Only clear after a successful flush, or keep a
  separate pending queue.
- **P2, boot race.** The mount `me()` can resolve after a fast login and set
  the user back to null (`AuthProvider.tsx:21` vs `:41`). Use a request
  generation or ignore `me()` after an explicit login.

## 10. Checkout attempt

**States:** `creating`, `open`, `paid`, `failed`, `expired`
(`db/schema.sql:245`). One live row per user (`:253`). The client intent is
`/account?plan=pro` (`Account.tsx:115`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| none | Upgrade click | creating | Insert row, call Paystack initialize |
| creating | Paystack returns URL | open | Store authorization URL, redirect browser |
| creating | Paystack error or no URL | failed | Row marked failed |
| open | Verify or webhook success | paid | Ledger and subscription apply |
| open | Verify non-success | open | Client toast only, same URL reused |
| creating older than 90 seconds | Next checkout | deleted | Cleanup |
| open older than 30 minutes | Next checkout | deleted | Cleanup |
| paid | New checkout | unchanged | 409, already Pro |
| failed | New checkout | creating | Old row deleted |

**Gaps**

- **P1, a paid checkout can be rejected after a price change.**
  `validProCharge` compares the charge to the current plan and amount
  (`billing.mjs:422`), not to the amount stored on the checkout row. A checkout
  opened before a price change can be paid and then refused. Validate against
  the checkout snapshot.
- **P2, `expired` is unreachable.** Stale rows are deleted, never marked
  expired (`billing.mjs:580`). Remove the state or add a cleanup transition.
- **P2, dead Paystack link reuse.** A non-success verify leaves the checkout
  open, so Upgrade returns the same link for 30 minutes (`billing.mjs:613`).
  Mark it failed or offer a fresh checkout.
- **P3, idempotency is client-only.** Every click mints a new key
  (`api.ts:335`). Only the one-live-row index prevents duplicates.
- **P2, plan intent repeats.** Every fresh mount of `/account?plan=pro` starts
  checkout again, including browser Back from Paystack (`Account.tsx:108`).
  Consume the intent with `history.replaceState` before redirecting.

## 11. Payment verification and ledger

**States:** transaction `success`, `failed`, `abandoned`, `unknown` plus
`applied_at` null or set (`billing.mjs:491`). Event `applied` true or false
with an `ignored_reason` (`:287`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| pending | Verify success for same user | applied | Checkout paid, subscription written, ledger stamped |
| pending | Verify non-success | pending | Returns `payment: pending` |
| pending | Webhook success | applied | Same path, idempotent by reference |
| any | Webhook duplicate event id | unchanged | `{duplicate: true}` |
| any | Webhook apply throws | unchanged, event row deleted | Paystack retry accepted |
| applied | Retry or refresh | applied | Second write reports needs_apply false |

**Gaps**

- **P1, lost first payment cannot be recovered.** Reconcile stops when the user
  has no subscription row (`billing.mjs:821`) and only verifies
  `existing.reference` (`:875`). It never reads `billing_checkouts.reference`.
  If both the browser return and webhook are lost, a paid first-time user stays
  free forever. Add checkout references to reconciliation.
- **P1, some successful charges never enter the ledger.** If
  `saveSubscription` returns stale or a cancellation tie, the charge is not
  recorded (`:998`), so the money is invisible. Record the transaction first,
  then decide entitlement.
- **P2, refunds and disputes are absent.** No event mapping or ledger reversal
  exists for `refund.*` or `charge.dispute`. Add them before launching refunds.

## 12. Subscription entitlement

**States:** `active`, `attention`, `non-renewing`, `cancelled`, `completed`
(`db/schema.sql:174`). `isEntitled` derives Pro or Free with grace windows
(`billing.mjs:196`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| absent or cancelled | `charge.success`, `subscription.create`, `subscription.enable` | active | Paid period written, Pro granted |
| active | `invoice.payment_failed` or failed update | attention | Pro continues through grace |
| attention | Paid invoice or charge | active | Grace cleared |
| active or attention | `subscription.not_renew` | non-renewing | Pro to period end |
| active, attention or non-renewing | `subscription.disable` | cancelled | Pro to period end, no renewal |
| cancelled | Newer charge | active | Reactivated |
| any | Reconcile returns completed | completed | Not entitled |
| completed | New paid checkout | active | New period |

**Gaps**

- **P1, dashboard cancellations are often ignored as stale.**
  `transactionEventAt` falls back to `created_at` for subscription events
  (`billing.mjs:803`). That date is older than the last charge, so
  `not_renew` and `disable` hit the stale guard (`:286`). Only reconciliation
  repairs it.
- **P2, attention never escalates.** Nothing moves attention to cancelled or
  free. Allowing the grace date to pass hides Pro silently.
- **P2, completed has no UI message.** The account card falls through to a
  generic ended message (`Account.tsx:76`).

## 13. Cancellation and reconciliation

**Cancellation:** active -> confirm -> Paystack disable -> local cancelled
(`billing.mjs:767`, `Account.tsx:176`). Pro remains until period end.

**Reconciliation:** fresh -> skip; stale -> query Paystack -> apply with source
`reconcile` -> stamp (`billing.mjs:817`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| active | Confirm cancel | cancelled | Paystack disabled, local row cancelled |
| cancelled or non-renewing | Confirm cancel | unchanged | Early return |
| cancelled | Reconcile sees active | active | Repair path |
| stale subscription | Cron | repaired or unchanged | Up to 5 rows per day |
| fresh subscription | Page load | unchanged | 10 minute cache |

**Gaps**

- **P1, cron throughput.** The daily sweep takes five subscriptions
  (`billing.mjs:911`). Repair lag grows without bound. Batch or page it.
- **P2, remote cancellation race.** If Paystack disable succeeds but the local
  write fails, the user sees "Renews on" while Paystack has already stopped.
  Reconciliation is the only repair. Make the local write retryable.
- **P2, cancel is unavailable when not entitled.** A stale free row with a live
  remote subscription cannot be cancelled from the UI (`Account.tsx:211`).

## 14. Usage quota

**Client states:** unknown, free within limit, free exhausted, pro within
limit, pro exhausted, enterprise (`usageStore.ts:41`). **Server:** monthly sum
over the `usage_ledger` table (`usage.mjs:47`), written in the same transaction
as a saved capture (`captures.mjs:112`), with a 10 second overage grace. Limits
come from `planMonthlySeconds`: 100 minutes free, 20 hours Pro, 1,000 hours
enterprise, and enterprise is shown as unlimited.

| From | Event | To | Effects |
| --- | --- | --- | --- |
| unknown | Billing status | free, pro or enterprise | Store updated |
| free or pro within limit | Capture saves | within limit or exhausted | Server sum changes |
| free or pro within limit | Capture would exceed | exhausted, save 402 | Local copy kept, sync parked |
| exhausted | Calendar month changes | within limit | Server UTC month |
| free | Upgrade | pro | 20 hours a month |
| pro | Enterprise activation | enterprise | Shown as unlimited, hidden 1,000 hour ceiling |
| pro | Period ends | free | Next refresh |
| any | Delete capture | usage unchanged | Ledger keeps minutes already spent |

**Gaps**

- **P2, 402 parks sync silently.** CloudSync stops retrying and does not
  refresh usage (`CloudSync.tsx:65`). The remaining bar stays stale.
- **P3, month boundary is UTC.** The UI does not show period start or end.

## 15. Paywall and plan intent

**Paywall:** closed or open (`Paywall.tsx:17`). **Plan intent:** absent,
pending via `?plan=pro`, consumed.

| From | Event | To | Effects |
| --- | --- | --- | --- |
| closed | Gated action | open | Dialog or panel |
| open | Upgrade | pending intent | Navigate to account or auth |
| pending intent | Auth success | account | Carry next path |
| pending intent | Account mount while free | checkout | Start Paystack |
| pending intent | Checkout error | account without intent | Intent lost |
| open | Dismiss | closed | No action |

**Resolved**

- Paywalls wait for `usage.loaded`, and Pro checks call `ensurePro()` before
  deciding (`usePlan`, `ensurePro` in `usageStore.ts`). A reload no longer
  flashes a paywall at a Pro user.
- `?plan=pro` is removed with `history.replaceState` before the Paystack
  redirect (`Account.tsx:117`), so Back lands on the account page and cannot
  start a second checkout.

**Gaps**

- **P3, intent is URL-only for other entries.** Deep links that are not
  `/account?plan=pro` still have no pending intent store.

## 16. Share link

**States:** active, expired (computed), revoked, deleted
(`db/schema.sql:139`, `share.mjs:47`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| none | Create within quota | active | Token hash stored, raw token returned once |
| none | Create over quota | unchanged, 402 | Paywall copy |
| none | Capture is confidential | unchanged, 409 | Public links are refused |
| active | Expiry passes | expired | Public 410 |
| active | Revoke | revoked | Owner only, unrevoked rows only |
| revoked | Revoke again | unchanged, 404 | No error detail |
| any | Capture or user delete | deleted | Cascade |
| expired or revoked | Public view | unchanged, 410 | No body |
| active | Public view | active | Views incremented, org retention applied |
| active | Capture became confidential or aged out | unchanged, 404 | Read filter hides it |

**Resolved**

- The live-link count and insert share one transaction behind
  `pg_advisory_xact_lock`, so concurrent creates cannot exceed the plan limit.
- Public reads require `sensitivity = 'standard'` and filter by the owning
  organisation's `retention_days`. A confidential capture cannot create a link.
- Unsharing a capture, or switching it to confidential, revokes every live link
  in the same transaction. Unsharing resets sensitivity to standard, so keeping
  the links would bring them back to life.

**Gaps**

- **P3, open tabs never revalidate.** Revocation or expiry does not invalidate
  an already loaded public page.

## 17. Share dialog

**States:** closed, loading links, idle, creating, created, error, paywall
(`ShareDialog.tsx:29`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| closed | Open | loading | Fetch links |
| loading | Links return | idle | Render list |
| idle | Make a link | creating | POST |
| creating | Success | created | Show URL once |
| creating | 402 | paywall | Upsell |
| creating | Other error | error | Retry available |
| idle or created | Revoke | idle | Optimistic revokedAt |
| any | Close | closed | State kept until next open |
| closed | Reopen | loading | Clears created and error |
| closed | Open a built-in example | idle | No fetch, explains that examples are device-only |

**Resolved**

- Example sessions never reach the server, so the dialog skips the link fetch
  and the create call instead of logging a 400 for a non-UUID id.

**Gaps**

- **P2, Pro at five links sees a paywall.** The 402 message is a Pro message,
  but the dialog treats every 402 as an upsell (`ShareDialog.tsx:49`).
- **P3, stale expiry.** `dead` is computed only on render, so an expiring link
  can keep showing Active.
- **P3, no abort.** Closing during the initial fetch can still overwrite links
  created in the meantime.

## 18. Org membership and role

**States:** owner, admin, manager, member, absent (`orgs.mjs:441`). There is no
pending invite state.

| From | Event | To | Guards |
| --- | --- | --- | --- |
| absent | Add existing account | member with role | Owner or admin |
| absent | Add unknown email | absent, 404 | No invite flow |
| member | Promote to manager or member | new role | Admin or owner |
| member or manager | Promote to admin | admin | Owner only |
| admin | Demote admin | admin | Admin cannot touch admin |
| owner | Change role | owner | Owner immutable |
| member | Remove | absent | Not owner, admin cannot remove admin |
| any | Delete org | absent | Cascade |

**Gaps**

- **P2, no ownership transfer.** The owner can never leave, and an abandoned
  owner account strands the org.
- **P2, role and department are separate writes.** Concurrent patches can
  interleave (`orgs.mjs:507`).
- **P2, removed members leave grants and captures.** Grant rows and `org_id`
  remain, but access disappears, creating orphaned content.
- **P2, unshare uses the wrong guard.** `unshareCapture` requires a session, not
  org membership (`orgs.mjs:774`).

## 19. Capture visibility and grants

**States:** `private`, `department`, `organisation` times `standard`,
`confidential`, plus explicit grants (`orgs.mjs:716`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| private | Share to department | department | Grants replaced transactionally |
| private or department | Share to organisation | organisation | Grants replaced |
| any | Unshare | private, standard | Org and department cleared |
| any | Member removed | grants orphaned | Access predicate changes |
| any | Retention window expires | hidden | Read filter only, no delete |

**Policy:** `confidential` means the owner, plus explicit named grants inside
the organisation. Department and organisation visibility never apply, and the
server forces the stored visibility back to `private` with no department.
Public share links are refused for confidential captures, and any older link
is filtered out on read.

**Gaps**

- **P2, two permission predicates diverge.** `viewCapture` accepts any status,
  while `queryMemory` requires ready (`orgs.mjs:880`).
- **P2, retention is not deletion.** Lowering the window hides data, and
  raising it brings it back. Add a deletion job and tombstones.

## 20. Org memory ask

**States:** idle, asking, answered, error per turn (`Memory.tsx:479`). Provider
chain is Groq GPT-OSS, OpenRouter free Gemma, the free router, xAI, demo
(`memory-ai.mjs`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| idle | Submit | asking | Pro gate, rate limit, provider call |
| asking | Answer | answered | Audit cited captures |
| asking | No accessible records | answered with none | Audit query |
| asking | Provider failure | error | Audit failed, 502 or 503 |
| error | Retry | asking | New attempt |
| any | Org changed | idle keyed by org | New panel |

**Gaps**

- **P2, in-memory rate limits.** Buckets never evict, reset on cold start, and
  count failed requests (`orgs.mjs:200`).
- **P2, stale permissions in an open panel.** Role changes are not reflected
  until the panel is remounted (`Memory.tsx:1790`).

## 21. Cloud sync

**States:** off, syncing, ready, error (`syncStore.ts:3`). Internal flags:
`ready`, `inFlight`, `dirty`, `removed`, `disposed`
(`CloudSync.tsx:34`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| off | User signed in, start | syncing | Pull server captures |
| syncing | Pull succeeds | ready | Snapshot, clear dirty, refresh usage |
| syncing | Pull fails | error | No automatic retry |
| ready | Local edit | syncing | Debounced flush |
| syncing | Save succeeds | ready | Last synced timestamp |
| syncing | Save fails | error | Retry after 6 seconds unless 402 |
| error | Retry succeeds | ready | Queue drains |
| any | Sign out | off | Suspend, reset, clear sessions |
| any | 402 | error | Parked with no visible retry |

**Gaps**

- **P1, a failed initial pull is terminal.** `ready` never becomes true, so the
  store subscriber drops every later edit (`CloudSync.tsx:98`, `:104`). Add
  backoff retry for the initial pull.
- **P1, offline edits can be overwritten by the first pull.**
  `pullAndMerge` replaces local copies not yet marked dirty (`cloud.ts:47`).
  Mark local edits dirty before the pull.
- **P2, one failed delete re-uploads everything.** `Promise.all` leaves all ids
  dirty (`CloudSync.tsx:50`). Use `allSettled` per id.
- **P2, in-flight flush survives sign-out.** A late write can land after the
  cookie is cleared. Abort on sign-out.

## 22. Desktop island

**States:** window hidden or shown; mouse interactive or ignored; pill
collapsed or expanded; status idle, recording, paused, processing
(`main.cjs:427`, `IslandPage.tsx:109`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| hidden | Main renderer publishes non-idle | shown | Recompute bounds, show inactive |
| shown | Main renderer publishes idle | hidden | Hide window |
| collapsed | Pointer enter | expanded | Interactive true |
| expanded | Pointer leave | collapsed | Interactive false |
| expanded | Expand button | expanded | Interactive true, no collapse path resets it |
| any | Processing | shown, spinner | Controls replaced |
| shown | Main window destroyed | shown or stale | No publisher, tray label stale |

**Gaps**

- **P2, click-through can stick.** The expand button sets interactive and the
  hide path does not reset `ignoreMouseEvents` (`IslandPage.tsx:183`). The next
  show can swallow clicks.
- **P3, dead IPC command.** `IslandCommand` includes `open`, but the main
  allowlist rejects it (`desktop.ts:20` vs `main.cjs:457`).
- **P3, multi-monitor drift.** Bounds are computed only on show, so moving the
  main window while recording leaves the island on the old display.

## 23. Desktop picker, hotkey, splash, tray

- **Picker:** closed -> open -> picked, cancelled or null. A second concurrent
  picker returns null immediately (`main.cjs:176`) and the capture is denied
  with no error.
- **Hotkey:** registered or unavailable. Registration failure only logs
  (`main.cjs:413`).
- **Splash:** shown -> closing -> closed, with a 10 second fallback and a
  failed-load path (`main.cjs:268`).
- **Tray:** Start listening or Stop listening. It updates only from
  `island:state` (`main.cjs:372`), so a missing renderer leaves it stale.
- **Close:** window close hides to tray unless quitting (`main.cjs:311`).
  Second instance opens the main window but does not re-show the island
  (`main.cjs:711`).

## 24. Audio retention

**States:** keep until deleted, 7, 30, 90 days (`retention.ts:5`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| any | Change setting | new window | No immediate prune |
| any | Mount, pull or sign-out | prune due blobs | `hasAudio` set false |
| any | Manual prune | prune due blobs | Toast count |
| any | Delete capture | delete blob | Best effort |

**Gaps**

- **P2, prune patches `hasAudio` even when IndexedDB delete fails.**
  `Promise.allSettled` swallows the error (`retention.ts:40`), orphaning blobs.
- **P3, shortening the window waits for the next trigger.** No timer or
  immediate prune on save.

## 25. Delete confirmation

**States:** closed, confirming, deleting (`SessionPage.tsx:247`, `:893`).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| closed | Delete | confirming | Confirm dialog |
| confirming | Cancel | closed | No delete |
| confirming | Confirm | deleting | Delete local audio, remove row, close |
| deleting | Success | closed | Navigate away |
| deleting | Failure | closed with toast | Depends on API error |

**Resolved, P3:** the delete button is disabled while the engine owns that
capture, `handleDelete` refuses it, and the server answers 409 for a live
capture. A later upsert can no longer resurrect it.

## 26. Password reset

**States:** none, requested, used, expired, revoked-by-new-request
(`server/api/auth.mjs:226`, `:262`, `db/schema.sql:353`).

| From | Event | To | Guards and effects |
| --- | --- | --- | --- |
| none | Forgot password | requested | Rate limits per IP and email, old unused tokens marked used, hashed token stored, email sent |
| none | Forgot password for unknown email | none | Same generic response, no row and no email |
| requested | Open link before expiry | requested | Token hash matches, `used_at` is null, form renders |
| requested | Open link after 60 minutes | expired | Generic invalid-link message |
| requested | Open link after a newer request | revoked-by-new-request | Generic invalid-link message |
| requested | Submit a valid new password | used | Password replaced, token marked used, all auth sessions deleted, password-changed email sent |
| requested | Submit a mismatched confirmation or short password | requested | Validation error, token stays unused |
| used | Open link again | used | Rejected, so a shared link cannot reset twice |

## 27. Enterprise invite

**States:** created, opened, accepted, expired, revoked
(`scripts/enterprise-invite.mjs`, `server/api/onboarding.mjs:83`,
`db/schema.sql:367`).

| From | Event | To | Guards and effects |
| --- | --- | --- | --- |
| created | Operator runs the CLI | created | Token shown once, hash stored, optional email, 30 day default expiry |
| created | Open the private link | opened | Hash checked, `opened_at` touched, noindex and no-referrer headers |
| opened | Toggle a checklist step | opened | `jsonb_set` on the matching step only |
| opened | Accept while signed out | opened | Sign-in link returns to the same token URL |
| opened | Accept while signed in | accepted | `accepted_at` and `accepted_by` saved once |
| created, opened | Operator revokes | revoked | Later GET, check, and accept all return 404 |
| created, opened, accepted | Past expiry | expired | GET returns 410, writes refuse |

The invite never creates a session and is not linked anywhere in the frontend,
so an unlisted URL alone cannot get past `/app` auth.

## 28. Connected apps and Jira handoff

**States:** disconnected, connecting, connected, needs-reconnect; handoff none,
sent, existing (`server/api/integrations.mjs:490`, `:828`, `db/schema.sql:398`).

| From | Event | To | Guards and effects |
| --- | --- | --- | --- |
| disconnected | Choose Connect | connecting | Pro and configured checks pass, a hashed single-use state is written, browser leaves for the provider |
| connecting | Provider returns with a matching state | connected | State is unused and unexpired, tokens exchanged and encrypted, connection upserted |
| connecting | Provider returns denied, error, or unknown state | disconnected | Account page shows a toast, no token is written |
| connected | Calendar read succeeds | connected | Google and Outlook only, next seven days, events sorted by start |
| connected | Calendar read returns 401 | needs-reconnect | `metadata.needsReconnect` saved, friendly warning shown, the other provider still loads |
| needs-reconnect | Reconnect succeeds | connected | Old row replaced, warning clears on the next read |
| connected | Disconnect | disconnected | Row deleted, Next up hides, existing Jira keys stay readable |
| none | Send selected actions | sent | Pro, connection, project, and issue type checked, one transaction per new action key |
| sent | Send the same action again | existing | Unique key returns the original ticket, no duplicate issue |
| none | Send without Jira connected | none | 404 tells the user to connect Jira first |

## Highest-risk gaps

| ID | Severity | Gap | Guard now in place |
| --- | --- | --- | --- |
| SM-01 | P1 | Lost first payment cannot reconcile | Reconciles from `billing_checkouts.reference`, including cron sweep |
| SM-02 | P1 | Subscription webhooks treated as stale | Orders by event time (`updated_at` for subscriptions, `paid_at` for money) |
| SM-03 | P1 | 401 leaves the client signed in | `jotbox:auth-expired` moves the app to signed out and keeps local captures |
| SM-04 | P1 | Sign-out clears unsynced captures | Flush runs first; only a clean flush clears the local cache |
| SM-05 | P1 | Price change rejects an already-paid checkout | Validates against the amount and plan stored on the checkout row |
| SM-06 | P1 | Confidential captures remain grant-shareable | Owner plus named grants only; server forces private; public links refused |
| SM-07 | P1 | Failed initial sync drops later edits | Initial pull retries with 1s doubling to 30s |
| SM-08 | P1 | Offline edits overwritten by first pull | Local edits are stamped dirty before pull and win the merge |
| SM-09 | P1 | Recording double-start leaks a stream | Synchronous `starting` guard covers start and import |
| SM-10 | P2 | Delete during recording resurrects the capture | UI disables delete while live; server returns 409 |
| SM-11 | P2 | Quota is refunded by deletion | `usage_ledger` meters minutes independently of captures |
| SM-12 | P2 | Pro UI flashes paywall on reload | Paywalls wait for `usage.loaded`; Pro checks refresh first |
| SM-13 | P2 | Processing can dead-end forever | Six minute watchdog turns a stuck capture `failed` |
| SM-14 | P2 | Auto-checkout repeats on Back | `plan=pro` is consumed with `replaceState` before redirect |
| SM-15 | P2 | Share quota race | Link count and insert share one transaction and advisory lock |

## Transition tests worth adding first

These tests catch the most expensive states without refactoring the app:

1. **Engine guard:** call `start()` twice in the same tick and assert one
   stream and one recorder.
2. **Engine watchdog:** stub notes to never resolve and assert a failed capture
   after the timeout.
3. **Delete while live:** delete a live id, then let the debounced upsert run,
   and assert the row stays deleted.
4. **Auth 401:** return 401 from captures and assert the app moves to signed
   out without losing local sessions.
5. **Sign-out flush failure:** fail the flush and assert unsynced captures
   survive.
6. **Sync boot failure:** fail the first pull, edit a capture, then restore the
   network and assert the edit syncs.
7. **Checkout reconciliation:** create a paid checkout with no subscription row
   and assert reconcile grants Pro.
8. **Webhook ordering:** send `charge.success`, then `subscription.disable`
   with a later event time, and assert cancelled wins.
9. **Quota delete:** record, delete, and assert usage does not go back to zero
   if the policy is meant to count consumed time.
10. **Share revoke:** revoke a link and assert the public token returns 410,
    including when the capture was unshared first.
11. **Confidential share:** attempt a grant on a confidential capture and
    assert the intended policy.
12. **Plan intent:** mount `/account?plan=pro` with a free user, fail checkout,
    and assert a second mount does not silently charge again.

## Maintenance rule

When you add a new flag with more than two meaningful values, add it here with
its transitions, or give it an explicit reducer. Two booleans that must never
both be true are a state machine waiting to produce a bug.
