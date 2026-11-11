# JotBox

**The notes are written while you listen.**

JotBox is a mobile-first notetaker for meetings, seminars, lectures, and voice notes. It listens through the microphone or a shared call tab, keeps a live transcript, lets you jot a line or two, and writes the summary, key points, actions, and sections when you stop. On a computer it can float above your other apps.

Guest-first. Sign in when you want your notes on another device — sessions, jottings, and transcripts sync through a Neon Postgres database; audio stays on the device.

**Live:** [jotbox-eight.vercel.app](https://jotbox-eight.vercel.app) · **Repo:** [github.com/luisjjj/Jotbox](https://github.com/luisjjj/Jotbox)

![JotBox landing page](docs/screenshots/landing-desktop.png)

## The product

Most note-taking tools ask you to type while someone is talking, or they join a call as a bot. JotBox is built for the way sessions actually happen here: a phone on the table in a lecture hall, a laptop on a Meet or Zoom call, a voice memo in traffic. No meeting bot, no calendar permissions, and no cloud library you have to maintain.

Four session shapes set the tone of the notes: **Meeting**, **Seminar**, **Lecture**, and **Voice note**.

## What is built

- **Capture** from the microphone, from a shared call/tab with your mic mixed in, or by uploading an audio file.
- **Live studio** with two panes: your jottings and the live transcript. On a phone the panes become tabs.
- **Written notes** with a summary, key points, action items (checkboxes and owners), and topic sections.
- **Repair paths** when a recording fails: paste or edit a transcript, retry transcription from the saved audio, or rewrite the notes from what was captured.
- **Floating companion** using Document Picture-in-Picture, so the timer, transcript, and scratchpad stay on top of other apps on desktop Chrome/Edge.
- **Library** with full-text search, session-type filters, and date groups.
- **Exports**: copy as Markdown, download `.md`, print, or save as PDF.
- **Guest mode**: recording, local notes, and the full UI work without an account.
- **Accounts and sync**: email/password signup, httpOnly session cookies, hashed passwords (scrypt), database-backed rate limits, and note/transcript sync to Neon.
- **Local-first audio**: sessions live in `localStorage` as an offline cache, audio blobs in IndexedDB, and cloud writes are debounced and retried.
- **PWA**: installable on a phone, standalone window, offline shell.
- **Graceful draft mode** if no AI key is configured: browser captions and on-device draft notes still work.

<div align="center">
  <img src="docs/screenshots/studio-mobile.png" width="260" alt="Live studio on a phone" />
  <img src="docs/screenshots/notes-mobile.png" width="260" alt="Written notes on a phone" />
  <img src="docs/screenshots/library-mobile.png" width="260" alt="Library on a phone" />
</div>

## Run it

```bash
npm install
```

Create `.env` from `.env.example` and add your Neon **owner** URL:

```env
DATABASE_URL_OWNER=postgresql://neondb_owner:...@.../neondb?sslmode=require
```

Then create the least-privilege application role and apply the schema:

```bash
npm run db:role     # creates jotbox_app, writes DATABASE_URL + APP_DB_PASSWORD into .env
npm run db:migrate  # idempotent schema: users, auth_sessions, captures, auth_attempts
```

Start the app:

```bash
npm run dev:web
```

Open **http://localhost:3100** for the landing page, then **http://localhost:3100/app** for the dashboard. Add `?demo=1` to any URL to load two example sessions (for example `http://localhost:3100/app?demo=1`).

The runtime uses the `jotbox_app` role, not the owner connection. The owner URL is only used by the migration and role-setup scripts.

The public **landing page** lives at `/`; the authenticated/guest **dashboard** lives at `/app`. The PWA starts at `/app`.

### Database scripts

| Command | What it does |
| --- | --- |
| `npm run db:role` | Creates/updates `jotbox_app`, grants table and sequence access, writes the app URL to `.env` |
| `npm run db:migrate` | Applies [`db/schema.sql`](db/schema.sql) with the owner connection |
| `npm run db:check` | Connects with the app role and lists tables |
| `node db/cleanup-tests.mjs` | Removes `test.*`, `ui.test.*`, `api.test.*` accounts (development only) |

### Studio transcription (optional)

Without a key, JotBox runs in **Draft mode**: the microphone still gets live browser captions, and notes are drafted on the device from the transcript and your jottings. Recording and uploads are saved locally, but they are not transcribed.

To turn on studio transcription, add to `.env`:

```env
XAI_API_KEY=your_key_here
```

The key is read by the Vite server only; it is never sent to the browser. Restart the dev server after adding it.

Optional model overrides:

```env
XAI_STT_MODEL=grok-voice-transcribe-2.0
XAI_NOTES_MODEL=grok-4.7
```

### Production build

```bash
npm run build:web
npm run preview:web
```

Preview runs on **http://localhost:3101** and includes the API middleware. The built app is in `apps/web/dist`.

### Deploy

The repo includes [`vercel.json`](vercel.json) for the SPA build, route fallback, and static asset caching. The Vercel project is connected to this GitHub repository, so **pushes to `main` deploy automatically**.

```bash
vercel env add DATABASE_URL production --sensitive   # the jotbox_app URL
vercel --prod
```

Deployed serverless routes live in [`api/`](api): auth (`register`, `login`, `logout`, `me`), `captures`, and `health`. Set `DATABASE_URL` to the **app role** URL in Vercel Production, Preview, and Development. Never add `DATABASE_URL_OWNER` to Vercel.

The studio endpoints (`/api/transcribe`, `/api/enhance`) still live in the Vite dev/preview middleware. A static Vercel deployment therefore runs in **Draft mode** until those are ported to functions and `XAI_API_KEY` is added.

For the recommended low-cost path — Groq for short clips and a self-hosted Whisper worker for long lectures — see **[docs/ai-providers.md](docs/ai-providers.md)**. It includes the Groq key steps, a ready-to-run [`worker/docker-compose.yml`](worker/docker-compose.yml), deployment notes, and the Vercel size-limit caveat.

## Screens

| Screen | What it does |
| --- | --- |
| Landing (`/`) | Public front door: the promise, how it works, a finished-note preview, privacy, and CTAs |
| Dashboard (`/app`) | Greeting, quick capture, capture stats, recent notes |
| Capture | Pick a session shape, name it, choose microphone / call tab / upload |
| Studio | Timer, notes pad, live transcript, pause/resume, float, stop and write |
| Notes | The written document, audio + transcript source panel, exports, rewrite |
| Library | Search, type filters, date groups |
| Account | Sign in / create account, cloud-sync status, profile, sign out |
| Float mode | How the companion window works on desktop and what is possible on a phone |
| Settings | Account, appearance, studio status, local data usage, export/clear, privacy |

![Written notes on desktop](docs/screenshots/notes-desktop.png)
![Live studio on desktop](docs/screenshots/studio-desktop.png)
![Account](docs/screenshots/account-desktop.png)

## How it works

```text
microphone / tab audio / upload
        │
        ├─ MediaRecorder ──> IndexedDB (audio, local only)
        │
        ├─ Web Speech API ──> live transcript lines
        │
        └─ on stop ──> /api/transcribe (studio mode)
                        │
                        └─ /api/enhance
                              summary + key points + actions + sections
                              │
                              └─ Zustand persisted session
                                    │
                        signed in? ──┴──> /api/captures ──> Neon Postgres
```

If the studio is unavailable, `buildNotes` falls back to `localNotes`: a transparent, on-device heuristics pass over the transcript and jottings. Draft notes are labelled **Draft notes · written on this device** so nobody mistakes them for a studio transcript.

### Auth and sync

- Passwords are hashed with `scrypt` and a per-user salt.
- Sessions are random 256-bit tokens; only a SHA-256 hash is stored in `auth_sessions`.
- Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`, and last 30 days.
- Mutating requests are checked against the request origin; login and signup have database-backed rate limits.
- The browser never receives the database credentials.
- Signing in uploads local captures that the account does not have, then pulls the account's captures. After that, changes are debounced and synced; failed writes retry while signed in.
- Signing out flushes pending local edits, clears the local copy, and revokes the session.
- The app uses a least-privilege `jotbox_app` Postgres role (`select`, `insert`, `update`, `delete` only) instead of the owner role.

### Data model

Database tables (see [`db/schema.sql`](db/schema.sql)):

- `users` — email, name, password hash
- `auth_sessions` — hashed tokens, expiry, user agent, last seen
- `captures` — owner, title, kind, status, duration, jottings, transcript JSONB, notes JSONB, audio flag
- `auth_attempts` — rate-limit counters
- `schema_migrations` — applied migration versions

Client types:

- `Session`: title, kind, status, duration, scratch notes, transcript, notes, audio flag
- `TranscriptLine`: speaker (optional), text, timestamp
- `SessionNotes`: summary, highlights, action items, sections, source (`studio` or `browser`)
- `ActionItem`: text, owner, done

## Stack

- React 18, Vite 5, TypeScript strict
- Tailwind CSS with a small custom design-token layer
- Zustand + `persist` for session cache; IndexedDB for audio
- React Router
- Neon Postgres + `pg` (app role; server-side only)
- Vercel Functions for auth, captures, and health
- xAI chat + speech-to-text endpoints (dev/preview)
- `vite-plugin-pwa` (Workbox)

### Project layout

```text
api/                        Vercel function entrypoints
server/api/                 shared auth, captures, DB, password, HTTP handlers
db/                         schema, migrations, role setup, smoke tests
apps/web/
  server/apiPlugin.ts       Vite dev/preview middleware (shared handlers + studio)
  src/auth/                 auth context
  src/components/           shell, transcript, sync, account UI
  src/engine/               capture engine (mic/tab, MediaRecorder, Web Speech, PiP)
  src/lib/                  notes, API client, cloud sync, formatting, exports
  src/pages/                Home, Listen, Session, Library, Account, Float, Settings
docs/screenshots/
```

## Limits worth knowing

- **Floating above other apps is desktop-only.** It uses Document Picture-in-Picture in Chrome/Edge 116+. iOS and Android do not let a browser window float over native apps. The phone experience is an installable PWA that keeps recording when you switch apps; live captions need JotBox in view.
- **Live captions are browser speech, not the studio model.** They are provisional and can stop when the tab is backgrounded. The recording itself continues; studio transcription cleans it up afterwards.
- **Audio does not sync.** Notes, jottings, and transcripts sync. Audio stays on the device that recorded it, so the transcript is the cross-device source.
- **Studio AI is not deployed yet.** `/api/transcribe` and `/api/enhance` are dev/preview middleware today; Vercel runs Draft mode.
- **Sync is last-write-wins.** Editing the same session on two devices at once can overwrite the older edit.
- **Account lifecycle is minimal.** There is no email verification, password reset, or account deletion yet.
- **Browser storage is still a cache.** If you are signed in, notes are recoverable from the account. Guest notes are only on the device.

## Roadmap

1. **Studio on the server** — port transcription and notes to functions (or a small service), add usage accounting and quotas.
2. **Account lifecycle** — email verification, password reset, delete-account, active-session management.
3. **Sharing** — read-only note links, WhatsApp/email share, PDF and DOCX exports.
4. **Capture depth** — system-audio guidance, calendar/meeting detection, persistent speaker names.
5. **Local languages** — Yoruba, Igbo, Hausa, and Nigerian Pidgin transcription, plus an offline Whisper path for low-connectivity rooms.
6. **Teams and monetisation** — shared spaces, templates, free minutes then a Pro plan.

See [implementation-plan.md](implementation-plan.md) for the working plan and decision log.
