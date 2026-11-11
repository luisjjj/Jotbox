# JotBox — Implementation Plan

_Last updated: 11 November 2026_

## 1. Positioning

JotBox is the notetaker for the room and the call. It listens to meetings, seminars, lectures, and voice notes, keeps a live transcript, and writes the summary, decisions, and actions — without asking the listener to type.

The product is mobile-first and account-optional. Guest mode works entirely on the device. Signing in adds cloud sync for notes and transcripts through Neon Postgres, while audio stays local. It is designed for the Nigerian context first: phones rather than Macs, intermittent connectivity, room audio rather than calendar bots, and a price point that fits a student or a small team.

**One-line promise:** _The notes are written while you listen._

**What it is not:** a meeting bot that joins calls, a cloud drive, a transcription dashboard, or a flashcard/quiz study app.

## 2. Product principles

1. **Stay present.** Every screen should reduce the effort of capturing, not add to it.
2. **Notes are the product.** The transcript is source material; the summary, decisions, and actions are the deliverable.
3. **Guest-first, account-optional.** No signup wall for a lecture. Sign in only to connect devices.
4. **Audio is private.** Audio stays on the recording device; only notes and transcripts sync.
5. **No dead ends.** Any failed transcription can be repaired by pasting a transcript, retrying, or rewriting.
6. **Professional, quiet UI.** A document-like reading surface, not a dashboard of widgets.

## 3. Current state

### Capture

- Microphone recording via `MediaRecorder`, with pause/resume.
- Call/tab capture using `getDisplayMedia` with tab audio, mixed with the microphone where the browser allows it.
- Resilient audio graph: the raw microphone records even if `AudioContext` cannot run; call mixing falls back to tab audio rather than a silent stream.
- Upload of `.webm`, `.mp4`, `.m4a`, `.mp3`, `.wav`, `.ogg` up to 80 MB.
- Screen Wake Lock while recording; `beforeunload` warning; audio saved to IndexedDB on stop.

### Understanding

- Live browser captions via the Web Speech API (`en-NG`), with provisional text in the transcript pane.
- Studio transcription via `/api/transcribe` (xAI STT, diarisation enabled) when a key is configured.
- Notes via `/api/enhance`: a strict JSON schema for summary, highlights, actions, and sections, with a kind-aware prompt.
- On-device `localNotes` fallback with sentence ranking, action detection, and speaker-aware owners.
- Transcript repair: paste/edit a transcript, retry transcription from saved audio, or rewrite notes.

### Reading and keeping

- Session document with summary, key points, action items, and topic sections.
- Source panel with audio player (seek from transcript timestamps), transcript, and jottings.
- Library search, kind filters, and date groups.
- Exports: copy Markdown, download `.md`, print/save as PDF.
- Editable titles, delete with confirmation, local data export, and clear-all in Settings.

### Accounts and sync (new)

- Email/password signup and login; scrypt password hashing with a per-user salt.
- Random 256-bit session tokens; SHA-256 hash stored in `auth_sessions`; 30-day expiry.
- `HttpOnly`, `Secure` in production, `SameSite=Lax` cookies.
- Origin checks on mutating requests and database-backed login/signup rate limits.
- Neon Postgres schema: `users`, `auth_sessions`, `captures`, `auth_attempts`, `schema_migrations`.
- Least-privilege runtime role `jotbox_app` (DML only); owner connection is used only by migrations and role setup.
- Shared API handlers used by both Vite dev/preview middleware and Vercel Functions.
- Guest-first sync model: sign-in uploads local captures the account lacks, then pulls cloud captures. Writes are debounced, retried, and flushed before sign-out. Sign-out clears the local copy.
- Account page with profile, sync state, retry, sign-out; account row in the desktop sidebar and mobile header.

### Companion and installation

- Floating companion using Document Picture-in-Picture (Chrome/Edge desktop). Persists across routes and closes cleanly when a session ends.
- PWA manifest, PNG install icons, Workbox service worker, offline shell, cached fonts.
- Light/dark/system appearance.

### Verified

- `npm run typecheck` clean; production build clean (~108 kB gzipped JS).
- Route audit at 390/360/320 px: no horizontal overflow, no console errors.
- End-to-end fake-microphone test: capture → jot → pause → stop → notes.
- Local and production auth smoke tests: register, login, me, logout, rate-limited paths, cross-origin rejection, captures CRUD, 401s, cookie flags.
- Sign-out clears the local cache; signing back in restores the cloud capture.
- Production Vercel functions connect to Neon with the app role.

## 4. Architecture

```text
Browser
├── React app (Vite, mobile-first PWA)
│   ├── capture engine (mic / tab / upload)
│   ├── Zustand local cache + IndexedDB audio
│   ├── auth context + cloud-sync queue
│   └── /api/* client
│
├── Vite dev/preview middleware
│   ├── shared auth + captures handlers
│   └── studio transcribe/enhance (xAI)
│
└── Vercel Functions (production)
    ├── api/auth/*        register, login, logout, me
    ├── api/captures      GET / POST / DELETE
    └── api/health
            │
            └── server/api/* (shared handlers)
                    │
                    └── Neon Postgres (jotbox_app role)
                        users, auth_sessions, captures, auth_attempts
```

- **State:** Zustand + `persist` in `localStorage` is the offline cache; IndexedDB holds audio; Postgres is the durable account copy of notes and transcripts.
- **Auth boundary:** the browser never sees database credentials or password hashes. The server sets cookies and scopes every capture query by `user_id`.
- **AI boundary:** the key lives only on the server. Studio endpoints are still dev/preview middleware; production Vercel runs Draft mode until they are ported.
- **Design system:** CSS custom-property tokens mapped into Tailwind; component classes in `@layer components` so utilities override predictably. Instrument Serif for editorial moments, Inter for the interface.

## 5. Next phases

### Phase 1 — Finish the account lifecycle (1–2 weeks)

- Email verification and password reset (needs a transactional email provider).
- Delete account and export account data.
- Active-session list and revoke-other-sessions.
- Password change and optional passkeys.
- Conflict handling beyond last-write-wins: per-session `updated_at`/version and merge UI.

### Phase 2 — Studio on the server (1–2 weeks)

- Port `/api/transcribe` and `/api/enhance` to Vercel Functions or a small worker service.
- Chunk long audio or use object storage because serverless request bodies are small.
- Usage accounting, quotas, retries, and cost controls.
- Real-device matrix: iPhone Safari, Android Chrome, desktop Chrome/Edge, low-end Android.

### Phase 3 — Sharing and retention (2 weeks)

- Read-only note links and image/PDF shares.
- WhatsApp-first share formatting; email; DOCX.
- Templates per session kind (standup, lecture, interview, voice memo).
- Calendar/meeting signals: detect an ongoing Meet/Zoom tab and prompt to capture.
- Onboarding: 30-second demo, permission education for mic and tab audio.

### Phase 4 — Depth and trust (3–4 weeks)

- Persistent speaker naming and merge/split.
- In-place transcript editing with note regeneration.
- Nigerian language options and a self-hosted Whisper path for offline/low-bandwidth rooms.
- End-to-end encrypted note sync (optional account).
- Data retention controls: auto-delete audio after N days; keep notes.

### Phase 5 — Business

- Free tier with a monthly transcription allowance; Pro tier.
- Team spaces and shared templates for small firms, faculties, and associations.
- Billing with Paystack/Flutterwave for Nigeria and Stripe internationally.
- Privacy page, terms, and a clear statement of what leaves the device.

## 6. Decisions log

| Decision | Why |
| --- | --- |
| Guest-first, account-optional | A lecture should not need a signup; sync is the reason to create an account |
| Neon Postgres + custom auth | The supplied Neon database is the source of truth; opaque server sessions avoid a third-party auth dependency |
| scrypt via Node crypto | No native dependency, memory-hard, well supported on Vercel Node runtime |
| Store only session token hashes | A database leak does not expose usable cookies |
| Least-privilege `jotbox_app` role | Limits blast radius if the API is compromised; owner credentials stay out of Vercel |
| Shared handlers for Vite + Vercel | One auth/captures implementation for local development and production |
| Local audio, cloud notes | Audio is large and sensitive; notes are the part people need across devices |
| Last-write-wins sync for v1 | Simple, deterministic, and enough before multi-device editing is common |
| Document Picture-in-Picture for overlay | The only browser-native way to stay above other windows without an extension |
| Mobile overlay is not promised | iOS/Android browsers cannot float above native apps; PWA + background recording is the honest answer |
| AI endpoints not on Vercel yet | Long audio exceeds serverless request limits; needs chunking/object storage |

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Sync conflicts on two devices | Last-write-wins now; per-session versions and merge UI next |
| Lost local edits when offline at sign-out | Flush before sign-out; failures are surfaced; local cache is only cleared after the attempt |
| Auth lifecycle gaps | Email verification, reset, delete-account, and session management are Phase 1 |
| Neon cold starts | Small pool, short timeouts, loading states; functions reuse the pool within an instance |
| Password/login abuse | DB-backed rate limits, generic login errors, Secure/HttpOnly cookies |
| Browser captions are inconsistent | Recording independent of captions; studio transcription after stop; clear status |
| API cost overruns | Quotas, rate limits, audio caps, usage ledger, draft fallback |
| Data loss from clearing site data | Account sync for signed-in users; exports for guests; audio-retention policy later |
| AI invents names/numbers | Strict schema, prompt rules, check-names note, transcript always visible |

## 8. Metrics to watch

- Guest → account conversion after the first capture.
- Capture completion: started → stopped → notes generated.
- Sessions synced per account; sync failure rate.
- Week-2 return rate of users with at least two sessions.
- Share/export rate per session.
- Median session length by kind.
- Cost per transcribed minute.

## 9. Open questions

1. Should the free tier include studio minutes, or only draft notes?
2. Is a native wrapper worth it for true mobile overlay, or is PWA enough for the first 10,000 users?
3. Which Nigerian language pairs matter first for lectures — Yoruba, Igbo, Hausa, or Pidgin?
4. Do teams need real-time shared notes, or is a share link sufficient?
5. Should audio be retained by default, or deleted automatically after notes are generated?
