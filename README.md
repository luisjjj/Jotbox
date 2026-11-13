# JotBox

**The notes are written while you listen.**

JotBox is a mobile-first notetaker for meetings, seminars, lectures, and voice notes. It listens through the microphone or a shared call tab, keeps a live transcript, lets you jot a line or two, and writes the summary, key points, actions, and sections when you stop. On a computer it can float above your other apps.

Guest-first. Sign in when you want your notes on another device: sessions, jottings, and transcripts sync through a Neon Postgres database; audio stays on the device.

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

### Transcription and notes (free first)

JotBox ships with a provider chain that prefers free infrastructure and falls back from there:

| Step | Provider | Env |
| --- | --- | --- |
| Short recordings | Groq `whisper-large-v3` | `GROQ_API_KEY` |
| Long recordings | Self-hosted Speaches / faster-whisper | `WHISPER_BASE_URL`, `WHISPER_API_KEY` |
| Notes (free) | Groq `openai/gpt-oss-120b` or OpenRouter free model | `GROQ_API_KEY` / `OPENROUTER_API_KEY` |
| Notes (premium) | xAI | `XAI_API_KEY` |
| No keys at all | On-device notes from the spoken words and jottings | None |

The prompts are written for Nigerian Pidgin and code-switching: Pidgin lines survive as they were said, quoted inside otherwise clear English notes, and names, amounts, dates, and decisions stay exact. Whisper is given Pidgin context through its prompt because it has no Nigerian Pidgin language token, so the request uses `language=en` with that context.

Capture setup and Settings also expose two listening controls. **Session focus** (`Off`, `Balanced`, `Strict`) drops clear side talk such as wifi or lunch before the notes are written; `Strict` also drops lines that never touch the session title or the roster. **Pickup** (`Balanced`, `Far voices`) trades noise suppression for gain and gentle compression so faint or distant speakers stay audible. Roster names are sent with both the transcription request and the notes prompt, so JotBox spells people the way the room does.

```env
GROQ_API_KEY=gsk_...
GROQ_STT_MODEL=whisper-large-v3
GROQ_NOTES_MODEL=openai/gpt-oss-120b

# Optional: long recordings
WHISPER_BASE_URL=https://your-worker.example.com/v1
WHISPER_API_KEY=choose-a-long-random-token
WHISPER_MODEL=Systran/faster-whisper-small

# Optional: free notes fallback and premium fallback
OPENROUTER_API_KEY=sk-or-...
XAI_API_KEY=...
```

Keys are read on the server only and never sent to the browser. Restart the dev server after changing `.env`.

With no provider configured, JotBox still records, keeps the spoken words from browser captions, and writes notes on the device. The UI also offers a paste-the-words path for recordings that could not be read automatically.

#### CLI checks

```bash
npm run ai:check   # shows which providers are configured
npm run ai:test    # transcribes a sample and writes notes against the configured provider
npm run ai:demo    # same flow with the local demo provider, no network or keys
npm run ai:sample  # writes .shots/ai-sample.wav for a local smoke test
```

`JOTBOX_AI_MOCK=1` runs the deterministic demo provider in development. It is ignored on Vercel deployments so a demo response can never reach production.

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

Deployed serverless routes live in [`api/`](api): auth (`register`, `login`, `logout`, `me`), `captures`, `health`, `transcribe`, `enhance`, and `orgs` (organisations, members, departments, sharing, audit, and memory; `/api/orgs/*` is rewritten to one shared handler to stay under the Hobby plan's 12-function limit). Set `DATABASE_URL` to the **app role** URL in Vercel Production, Preview, and Development. Never add `DATABASE_URL_OWNER` to Vercel. Add the provider keys you intend to use (`GROQ_API_KEY`, `WHISPER_BASE_URL`, `OPENROUTER_API_KEY`, `XAI_API_KEY`) as sensitive environment variables.

**Request size:** Vercel Functions cap a request body at roughly **4.5 MB**, so long recordings must go through the self-hosted worker directly or through object storage. Short clips work through `/api/transcribe` as-is. See [docs/ai-providers.md](docs/ai-providers.md) for the options.

For the recommended low-cost path (Groq for short clips and a self-hosted Whisper worker for long lectures), see **[docs/ai-providers.md](docs/ai-providers.md)**. It includes the Groq key steps, a ready-to-run [`worker/docker-compose.yml`](worker/docker-compose.yml), deployment notes, and the Vercel size-limit caveat.

## Screens

| Screen | What it does |
| --- | --- |
| Landing (`/`) | Public front door: the promise, Pidgin and tone, how it works, a finished-note preview, pricing, privacy, and CTAs |
| Auth (`/auth`) | Standalone sign in and create account. Signed-out visitors are sent here first; signed-in visitors continue to their destination |
| Dashboard (`/app`) | Greeting, quick capture, capture stats, recent notes |
| Capture (`/listen`) | Pick a session shape, name it, choose microphone / call tab / upload |
| Live capture | Timer, jottings pad, live words, pause/resume, float, stop and write |
| Notes (`/session/:id`) | The written document, audio + spoken-words panel, exports, rewrite |
| Library (`/library`) | Search, type filters, date groups |
| Account (`/account`) | Cloud status, profile, plan, sign out |
| Float mode (`/float`) | How the floating pill works on desktop and what is possible on a phone |
| Settings (`/settings`) | Account, appearance, local data usage, exports, privacy |

![Written notes on desktop](docs/screenshots/notes-desktop.png)
![Live studio on desktop](docs/screenshots/studio-desktop.png)
![Account](docs/screenshots/account-desktop.png)

## How it works

```text
microphone / tab audio / upload
        │
        ├─ MediaRecorder ──> IndexedDB (audio, local only)
        │
        ├─ Web Speech API ──> live words
        │
        └─ on stop ──> /api/transcribe (Groq → self-hosted worker → xAI)
                        │
                        └─ /api/enhance (Groq / OpenRouter free → xAI)
                              summary + key points + actions + sections
                              │
                              └─ Zustand persisted session
                                    │
                        signed in? ──┴──> /api/captures ──> Neon Postgres
```

If no provider is available, `buildNotes` falls back to `localNotes`: an on-device pass over the spoken words and jottings. Those notes are labelled **Quick notes · written on this device** so nobody mistakes them for notes written from the recording.

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

- `users`: email, name, password hash
- `auth_sessions`: hashed tokens, expiry, user agent, last seen
- `captures`: owner, title, kind, status, duration, jottings, transcript JSONB, notes JSONB, audio flag
- `auth_attempts`: rate-limit counters
- `schema_migrations`: applied migration versions

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
- Vercel Functions for auth, captures, health, transcription, and notes
- Groq Whisper + LLaMA, self-hosted Speaches/faster-whisper, OpenRouter free notes, xAI fallback
- `vite-plugin-pwa` (Workbox)
- Self-hosted SF Pro Display for the interface

### Project layout

```text
api/                        Vercel function entrypoints (auth, captures, health, transcribe, enhance)
server/api/                 shared AI gateway, auth, captures, DB, password, HTTP handlers
worker/                     optional Speaches / faster-whisper Docker setup
scripts/                    AI checks, sample audio, smoke tests
db/                         schema, migrations, role setup, smoke tests
apps/web/
  server/apiPlugin.ts       Vite dev/preview middleware (shared handlers + AI)
  src/auth/                 auth context, RequireAuth guard
  src/components/           shell, words view, sync, account UI, scroll progress
  src/engine/               capture engine (mic/tab, MediaRecorder, Web Speech, PiP)
  src/lib/                  notes, API client, cloud sync, formatting, exports
  src/pages/                Landing, Auth, Home, Listen, Session, Library, Account, Float, Settings
  public/fonts/             SF Pro Display WOFF files
docs/screenshots/
```

## Limits worth knowing

- **The floating pill is desktop-only.** It uses Document Picture-in-Picture in Chrome/Edge 116+ to keep a small pill above other windows and websites. It is not injected into the website itself; browsers do not allow a site to draw its own overlay inside another site. iOS and Android do not let a browser window float over native apps. The phone experience is an installable PWA that keeps recording when you switch apps; live words need JotBox in view.
- **Live words are browser speech, not the recording pass.** They are provisional and can stop when the tab is backgrounded. The recording itself continues; the transcription provider cleans it up afterwards.
- **Audio does not sync.** Notes, jottings, and spoken words sync. Audio stays on the device that recorded it, so the spoken words are the cross-device source.
- **Long audio needs the worker or storage.** Vercel Functions cap requests near 4.5 MB. Short clips work through `/api/transcribe`; long lectures need the self-hosted worker or an upload-to-storage flow.
- **Nigerian Pidgin has no Whisper language token.** The request uses `language=en` plus a Pidgin prompt, so recognition quality varies. Names and amounts should still be checked before sending notes on.
- **Sync is last-write-wins.** Editing the same session on two devices at once can overwrite the older edit.
- **Account lifecycle is minimal.** There is no email verification, password reset, or account deletion yet.
- **Browser storage is still a cache.** If you are signed in, notes are recoverable from the account. Guest notes are only on the device.

## Roadmap

1. **Long-audio uploads:** direct-to-worker or object-storage uploads so recordings over the Vercel request limit work in production.
2. **Account lifecycle:** email verification, password reset, delete-account, active-session management.
3. **Sharing:** read-only note links, WhatsApp/email share, PDF and DOCX exports.
4. **Capture depth:** system-audio guidance, calendar/meeting detection, persistent speaker names.
5. **Local languages:** stronger Yoruba, Igbo, and Hausa recognition, Pidgin-aware evaluation, and an offline Whisper path for low-connectivity rooms.
6. **Teams and billing:** shared spaces, seat management, and paid plans behind the landing-page pricing.

See [implementation-plan.md](implementation-plan.md) for the working plan and decision log.
