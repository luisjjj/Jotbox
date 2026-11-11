# JotBox — Implementation Plan

_Last updated: 11 November 2026_

## 1. Positioning

JotBox is the notetaker for the room and the call. It listens to meetings, seminars, lectures, and voice notes, keeps a live transcript, and writes the summary, decisions, and actions — without asking the listener to type.

The product is mobile-first, account-free, and local-first. It is designed for the Nigerian context first: phones rather than Macs, intermittent connectivity, room audio rather than calendar bots, and a price point that fits a student or a small team.

**One-line promise:** _The notes are written while you listen._

**What it is not:** a meeting bot that joins calls, a cloud drive, a transcription dashboard, or a flashcard/quiz study app. Those were earlier directions and have been retired.

## 2. Product principles

1. **Stay present.** Every screen should reduce the effort of capturing, not add to it.
2. **Notes are the product.** The transcript is source material; the summary, decisions, and actions are the deliverable.
3. **Work on one device, without an account.** Local audio and sessions by default. Cloud is a later, explicit choice.
4. **Be honest about confidence.** Studio notes and on-device draft notes are visibly different.
5. **No dead ends.** Any failed transcription can be repaired by pasting a transcript or rewriting from what was captured.
6. **Professional, quiet UI.** A document-like reading surface, not a dashboard of widgets.

## 3. Current state (shipped in this build)

### Capture

- Microphone recording via `MediaRecorder`, with pause/resume.
- Call/tab capture using `getDisplayMedia` with tab audio, mixed with the microphone where the browser allows it.
- Resilient audio graph: the raw microphone stream records even if `AudioContext` cannot run; call mixing falls back to tab audio rather than a silent stream.
- Upload of `.webm`, `.mp4`, `.m4a`, `.mp3`, `.wav`, `.ogg` up to 80 MB.
- Screen Wake Lock while recording; `beforeunload` warning; audio saved to IndexedDB on stop.

### Understanding

- Live browser captions via the Web Speech API (`en-NG`), with provisional text in the transcript pane.
- Studio transcription via `/api/transcribe` (xAI STT, diarisation enabled) when a key is configured.
- Notes via `/api/enhance`: a strict JSON schema for title, summary, highlights, actions, and sections, with a tailored system prompt for meetings, seminars, lectures, and voice notes.
- On-device `localNotes` fallback: sentence ranking, action detection, speaker-aware owners, and scratch-note expansion. Labelled as draft notes.
- Transcript repair: paste or edit a transcript and rewrite the notes from it.

### Reading and keeping

- Session document with summary, key points, action items with owners and completion state, and topic sections.
- Source panel with audio player (seek from transcript timestamps), transcript, and jottings.
- Library: full-text search over titles, summaries, jottings, and transcripts; kind filters; date grouping.
- Exports: copy Markdown, download `.md`, print/save as PDF with a dedicated print stylesheet.
- Editable titles, delete with confirmation, local data export, and clear-all in Settings.

### Companion and installation

- Floating companion window using Document Picture-in-Picture (Chrome/Edge desktop). It persists across routes and closes cleanly when a session ends.
- PWA manifest and Workbox service worker; standalone display; installable on a phone.
- Appearance: light, dark, or system.

### Verified

- `tsc --noEmit` clean; production build clean (`~102 kB` gzipped JS).
- Route audit at 390 px, 360 px, and 320 px: no horizontal overflow, no console errors.
- End-to-end fake-microphone test: capture → jot → pause → resume → stop → written notes.
- Manual flows tested: transcript repair, note rewrite, action toggling, sample seeding, mobile tabs.

## 4. Architecture

```text
apps/web
├── server/apiPlugin.ts       Dev + preview middleware for health/transcribe/enhance
├── src/engine/               Capture lifecycle, MediaRecorder, Web Speech, PiP, wake lock
├── src/lib/
│   ├── buildNotes.ts         Orchestrates transcription → studio or local notes
│   ├── localNotes.ts         On-device draft note writer
│   ├── store.ts              Zustand + persist (sessions, last kind)
│   ├── audioStore.ts         IndexedDB audio blobs
│   ├── exportNotes.ts        Markdown, text, print/PDF
│   ├── seed.ts               Example sessions
│   └── transcript.ts         Word → line assembly, pasted text parsing
├── src/components/           App shell, transcript, waveform, dialogs, float window
└── src/pages/                Home, Listen, Session, Library, Float, Settings
```

**State:** Zustand with `persist` in `localStorage`; audio in IndexedDB. No auth or remote database in this phase.

**AI boundary:** the API key lives only on the server. The browser calls same-origin `/api/*` endpoints. If they are unavailable, the client degrades to draft mode. This is deliberate: the app must remain useful offline and without an account.

**Design system:** CSS custom-property tokens (`--paper`, `--ink`, `--accent`, …) mapped into Tailwind; component classes live in `@layer components` so utility overrides behave predictably. Instrument Serif is used only for editorial moments (hero, summary); Inter carries the interface.

## 5. Next phases

### Phase 1 — Deployable studio (1–2 weeks)

- Port `/api/health`, `/api/transcribe`, and `/api/enhance` to serverless functions (Vercel Functions or Supabase Edge Functions) and share the request/response types with the web app.
- Add request-size limits, timeouts, retries, and per-IP rate limiting.
- Usage ledger: minutes transcribed and notes generated, per anonymous device id.
- Deployment: Vercel for the app, one serverless runtime for the API, environment secrets.
- Run a real-device test matrix: iPhone Safari, Android Chrome, desktop Chrome/Edge, low-end Android.

### Phase 2 — Sharing and retention (2 weeks)

- Share a note as a read-only page or image; native share sheet on mobile.
- WhatsApp-first export formatting; email; DOCX.
- Note templates per session kind (standup, lecture, interview, voice memo).
- Calendar/meeting signals: detect an ongoing Meet/Zoom tab and prompt to capture.
- Onboarding: 30-second demo, one-tap sample notes, permission education for mic and tab audio.

### Phase 3 — Depth and trust (3–4 weeks)

- Speaker naming that persists across sessions ("Ada", "Chinedu"), with merge/split.
- Transcript editing in place with note regeneration.
- Nigerian language options and a self-hosted Whisper path for offline/low-bandwidth rooms.
- Local-first sync: optional account, end-to-end encrypted note sync, conflict handling.
- Data retention controls: auto-delete audio after N days, keep notes.

### Phase 4 — Business (parallel)

- Free tier with a monthly transcription allowance; Pro tier.
- Team spaces and shared templates for small firms, faculties, and churches/associations.
- Billing with Paystack/Flutterwave for Nigeria and Stripe internationally.
- Privacy page, terms, and a clear statement of what leaves the device.

## 6. Decisions log

| Decision | Why |
| --- | --- |
| Mobile-first web app, not a native app | Installable, no store review, one codebase, works on the phones people already have |
| Local-first, no account | Trust and speed in a market wary of cloud subscriptions; shipping sooner |
| Server-side AI key, same-origin API | Keeps the key out of the bundle; can move to serverless without changing the client |
| xAI for STT + notes | One provider for both, structured output, diarisation; model ids overridable by env |
| Draft notes on device | The product must still produce something useful when the API is unavailable |
| Document Picture-in-Picture for overlay | The only browser-native way to stay above other windows without an extension |
| Phone overlay is not promised | iOS/Android browsers cannot float above native apps; the honest answer is PWA + background recording |
| Audio in IndexedDB, sessions in localStorage | Simple, fast, no account; audio can be large, state must be small |
| No flashcards/quizzes | The pivot is notes and summaries, not study tools; keeps scope focused |

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Browser captions are inconsistent | Keep recording independent of captions; studio transcription after stop; clear status in the studio |
| Background tabs stop captions | Copy explains that audio continues; wake lock and the floating window keep JotBox visible on desktop |
| Mobile overlay expectations | Set expectations in Float mode; ship PWA install and split-screen guidance; evaluate a native shell later |
| API cost overruns | Per-device quotas, rate limits, audio-duration caps, usage ledger, fallback to draft mode |
| Data loss from clearing storage | Export all in Settings; Markdown/PDF downloads; auto-delete policy for audio only |
| Privacy concerns with meeting audio | Default local-only, explicit key requirement, no third-party analytics, clear Settings copy |
| AI invents names or numbers | Strict schema, prompt rules against invention, "check names and numbers" note, transcript always visible |

## 8. Metrics to watch

- Capture completion: started → stopped → notes generated.
- Time to first useful note after stop.
- Share/export rate per session.
- Week-2 return rate of users with at least two sessions.
- Draft-mode vs studio-mode share (how often the key is the blocker).
- Median session length by kind (meeting, lecture, voice).
- Cost per transcribed minute.

## 9. Open questions

1. Should the free tier include studio minutes, or only draft notes?
2. Is a native wrapper worth it for true mobile overlay, or is PWA enough for the first 10,000 users?
3. Which Nigerian language pairs matter first for lectures — Yoruba, Igbo, Hausa, or Pidgin?
4. Do teams need real-time shared notes, or is a share link sufficient?
5. Should audio be retained by default, or deleted after notes are generated?
