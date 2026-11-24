# AI providers: Scribe, Groq and a self-hosted Whisper worker

This guide covers the provider chain already wired into `/api/transcribe` and
`/api/enhance`:

| Path | Use it for | Cost | Limits |
| --- | --- | --- | --- |
| ElevenLabs Scribe v3 | Every recording and live caption; speaker labels on every capture except a voice note, and name boosting on every plan | Paid by audio hour | No Pidgin language code, so Pidgin runs on auto-detect |
| Browser Web Speech + on-device notes | Live words and notes with no provider | Free | Mic only, no upload transcription, no speaker separation |
| Groq Whisper | Fallback reader when Scribe is not configured | Free tier, then paid | 25 MB per file on the free tier |
| Speaches + faster-whisper | Long lectures, offline/low-bandwidth setups | Your compute | Model size and CPU/GPU decide speed |
| Groq GPT-OSS 120B | Reports, notes and organisation memory | Groq free tier, then paid | Model deprecation and Groq rate limits |
| OpenRouter free models (Gemma 4 31B, free router) | Reports, notes and organisation memory | $0 | 20 requests a minute, 50 a day until $10 lifetime credits, then 1,000 a day |
| xAI | One-key premium speech and notes | Paid | Provider pricing and rate limits |

Scribe reads every plan, every session shape, and both passes: the live captions,
cut about every five seconds at a gap in speech, and the final full recording.
Speaker labels are requested on every capture except a voice note, on free as
well as paid plans. The names on the roster, the room vocabulary and any
configured terms are sent as keyterms on every plan, which adds $0.05 an audio
hour on the final pass. Live chunks never ask for labels because a short chunk
cannot carry speaker ids that line up with the next one, and they stay
unboosted so the live pass holds its price.

Without Scribe, routing falls back to Groq for speech, then the self-hosted
worker; Igbo goes straight to the worker because Whisper does not list it.
Notes, reports and organisation memory go to Groq GPT-OSS first
(free tier), then OpenRouter's free models (Gemma 4 31B, then the free
router), then xAI. With no keys the app still records, keeps live browser
words, and writes notes on the device.

Reports are written at three levels of detail. The summary is two or three
short paragraphs, highlights run from 5 to 10 full sentences, and sections run
from 3 to 6 with concrete bullets that carry names, amounts, dates and Pidgin
quotes. Detail follows the material: a short clip stays tight and a voice note
stays to a line or two. The writer is told never to invent names, numbers,
dates or quotes to fill the page.

The prompts preserve Nigerian Pidgin and tone: Pidgin lines stay as they were said
and are quoted inside otherwise clear English notes; names, amounts, dates, and
decisions stay exact. Scribe does not list Nigerian Pidgin as a language, so
Pidgin requests are sent without a language code and the model auto-detects the
English/Pidgin mix. Name accuracy comes from the roster and room words sent as
keyterms, plus the naming pass; Enterprise adds the organisation glossary to
that same list.

Set `JOTBOX_STT_PROVIDER` to pin the provider order, for example `groq,elevenlabs`,
when comparing providers on the same recording. A pinned order is tried as
written; without the pin Scribe goes first and everything else is a fallback.
The pin does not change the plan rules: every plan gets the same labels and
keyterms, and only a voice note skips labels.

---

## 1. Get an ElevenLabs Scribe key

1. Sign in at **[elevenlabs.io](https://elevenlabs.io)**.
2. Open **Settings**, then **API Keys**, and create a key for JotBox.
3. Add it to your local `.env`:

   ```env
   ELEVENLABS_API_KEY=...
   ELEVENLABS_STT_MODEL=scribe_v3
   ```

4. Add it to Vercel:

   ```bash
   vercel env add ELEVENLABS_API_KEY production --sensitive
   vercel env add ELEVENLABS_API_KEY preview --sensitive
   ```

Notes:

- `model_id=scribe_v3` is requested with word timestamps. Every capture except a
  voice note adds `diarize=true`, on every plan. The app maps Scribe speaker ids
  to `Speaker 1`, `Speaker 2`, then the existing naming pass assigns real names.
- `keyterms` are sent on every plan when there are terms to send, built from the
  participant roster, the organisation glossary, `JOTBOX_STT_VOCAB` and
  `JOTBOX_STT_KEYTERMS`, capped at 100 terms. Keyterms bill Scribe at the higher
  rate, so the final pass is the only one boosted; live chunks stay unboosted.
- If the account rejects a language code or the keyterm list, the adapter retries
  once with auto-detect and no keyterms so the recording is not lost.

---

## 2. Get a Groq API key

1. Sign in at **[console.groq.com](https://console.groq.com)** (Google, GitHub, or email).
2. Open **[API Keys](https://console.groq.com/keys)**.
3. Choose **Create API Key**, give it a name like `jotbox-prod`, and copy the value
   (`gsk_...`). It is only shown once.
4. Optionally review **Billing** and **Limits** in the console. The free tier is
   rate-limited; the [speech-to-text docs](https://console.groq.com/docs/speech-to-text)
   list the current file-size and model limits.
5. Add it to your local `.env`:

   ```env
   GROQ_API_KEY=gsk_...
   GROQ_STT_MODEL=whisper-large-v3
   GROQ_NOTES_MODEL=openai/gpt-oss-120b
   ```

6. Add it to Vercel for the deployed functions:

   ```bash
   vercel env add GROQ_API_KEY production --sensitive
   vercel env add GROQ_API_KEY preview --sensitive
   vercel env add GROQ_API_KEY development --sensitive
   ```

### Test the key

```bash
curl.exe https://api.groq.com/openai/v1/audio/transcriptions ^
  -H "Authorization: Bearer %GROQ_API_KEY%" ^
  -F "file=@sample.m4a" ^
  -F "model=whisper-large-v3" ^
  -F "response_format=verbose_json" ^
  -F "timestamp_granularities[]=word"
```

Models:

- `whisper-large-v3`: the fallback default. More accurate on accented, faint,
  fast and noisy rooms than the cheaper turbo model.
- `whisper-large-v3-turbo`: faster and cheaper; used for fallback live chunks
  when latency matters more than accuracy on a clear English room.
- Groq's free tier caps uploads at **25 MB** and does **not** provide speaker
  diarisation. Groq is a fallback reader only, so a meeting read by Groq keeps no
  speaker ids. Long lectures need the worker below or audio chunking.

---

## 3. Run the Whisper worker locally

The worker is [Speaches](https://speaches.ai/), an OpenAI-compatible server powered
by `faster-whisper`. The repo includes [`worker/docker-compose.yml`](../worker/docker-compose.yml).

1. Install Docker Desktop.
2. Create `worker/.env`:

   ```env
   WHISPER_API_KEY=choose-a-long-random-token
   ```

3. Start it:

   ```bash
   cd worker
   docker compose up -d
   ```

   The first start downloads `Systran/faster-whisper-small` into a named volume.
   CPU `int8` is the default; it is usable for clear speech but not fast.

4. Check health and transcribe:

   ```bash
   curl.exe http://localhost:8000/health

   curl.exe http://localhost:8000/v1/audio/transcriptions ^
     -H "Authorization: Bearer choose-a-long-random-token" ^
     -F "file=@sample.m4a" ^
     -F "model=Systran/faster-whisper-small" ^
     -F "response_format=verbose_json" ^
     -F "timestamp_granularities[]=word"
   ```

### Model choices

| Model | Hardware | Notes |
| --- | --- | --- |
| `Systran/faster-whisper-small` | 2 GB RAM CPU | Good default for short lectures/calls |
| `Systran/faster-whisper-medium` | 4 GB RAM CPU | Better accuracy, slower |
| `Systran/faster-whisper-large-v3` | GPU (8 GB+) | Best accuracy; use `latest-cuda` image |

For GPU deployment, use `ghcr.io/speaches-ai/speaches:latest-cuda`, pass
`--gpus all`, set `WHISPER__INFERENCE_DEVICE=cuda`, and use
`WHISPER__COMPUTE_TYPE=float16`.

---

## 4. Deploy the worker

Do not expose an unauthenticated worker. Always set `API_KEY` and use HTTPS.

### Railway (simplest)

1. Create a new Railway project and choose **Deploy from Docker image**.
2. Image: `ghcr.io/speaches-ai/speaches:latest-cpu`.
3. Add a volume mounted at `/home/ubuntu/.cache/huggingface/hub`.
4. Add environment variables:

   ```env
   API_KEY=<long-random-token>
   ENABLE_UI=false
   PRELOAD_MODELS=["Systran/faster-whisper-small"]
   STT_MODEL_TTL=-1
   WHISPER__INFERENCE_DEVICE=cpu
   WHISPER__COMPUTE_TYPE=int8
   ```

5. Allocate at least **2 GB RAM** for `small`; use a GPU service for `large-v3`.
6. Generate a public domain, then test `/health` and `/v1/audio/transcriptions`
   with the bearer token.

### Render

1. New **Web Service** → **Deploy an existing image**.
2. Image: `ghcr.io/speaches-ai/speaches:latest-cpu`.
3. Add a persistent disk at `/home/ubuntu/.cache/huggingface/hub`.
4. Add the same environment variables. Choose an instance with enough RAM; the
   free 512 MB instance is not enough for `small` under load.
5. Set the health check to `/health`.

### Fly.io / VPS

Run the same image with a persistent volume. On a VPS, use the Docker command
from the [Speaches installation docs](https://speaches.ai/installation/), plus a
reverse proxy (Caddy/Nginx) and HTTPS. Keep port 8000 private if the reverse proxy
is on the same host.

---

## 5. Get an OpenRouter key

OpenRouter carries reports, notes and organisation memory.

1. Sign in at **[openrouter.ai](https://openrouter.ai)** with email, Google or
   GitHub.
2. Open **Settings**, then **API Keys**, and click **Create Key**. Name it
   `JotBox server`.
3. Copy the value that starts with `sk-or-v1-`. It is shown once. Store it in a
   password manager; if you lose it, create a new key.
4. Free models cost $0. No balance is needed for the first 50 requests a day.
   Adding $10 of credits once raises the free limit to 1,000 requests a day, and
   that balance is not spent on free models. Paid models are only used if you
   pin one with `OPENROUTER_NOTES_MODEL` or `OPENROUTER_MEMORY_MODEL`.
5. Set the key in Vercel for **Production**, **Preview** and **Development**, and
   in your local `.env`:

   ```env
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

6. Redeploy so the new variable is picked up.

Model chain, first to last:

| Attempt | Model | Cost |
| --- | --- | --- |
| 1 | Groq `openai/gpt-oss-120b` | Groq free tier, then paid |
| 2 | Groq `openai/gpt-oss-20b` | Groq free tier, then paid |
| 3 | `google/gemma-4-31b-it:free` | $0 |
| 4 | `openrouter/free` (picks a live free model) | $0 |
| 5 | xAI `grok-4.7` | xAI pricing |

Groq is first because its GPT-OSS 120B writer passed the plant-and-check probe:
6 of 6 report facts, correct owner and deadline, Pidgin kept, no invented names,
and 3 of 3 on organisation memory. The OpenRouter free models are the fallback
for when Groq is rate limited. Free models are shared capacity and can be busy
or rate limited; when that happens JotBox tries the next model, then xAI, so a
report still lands.

`OPENROUTER_NOTES_MODEL` and `OPENROUTER_MEMORY_MODEL` are optional overrides.
Setting one replaces the free chain. Never prefix the key with `VITE_`, and
never commit it: a prefixed key is bundled into the browser app.

### Pinning a paid writer

The free chain is the default. If a paid writer is ever needed, add
`JOTBOX_NOTES_PROVIDER=openrouter` so OpenRouter runs ahead of Groq, then pin a
model:

```env
JOTBOX_NOTES_PROVIDER=openrouter
OPENROUTER_NOTES_MODEL=openai/gpt-4o
```

Live OpenRouter prices on 23 November 2026:

| Model | Input | Output | Context | Rough cost per one hour report |
| --- | --- | --- | --- | --- |
| `openai/gpt-4o` | $2.50 / M tokens | $10.00 / M tokens | 128k | about $0.05 to $0.08 |
| `openai/gpt-4o-mini` | $0.15 / M tokens | $0.60 / M tokens | 128k | under $0.01 |
| `openai/gpt-5-nano` | $0.05 / M tokens | $0.40 / M tokens | 400k | under $0.01 |

GPT-4o is not free. It is a sound writer, but it is not needed for the quality
floor: the free Groq writer already produced the full report in the probe. Pay
for it only when a session needs its longer reasoning, and remember that Scribe
stays the speech provider, so the change is billed per report and nothing else.

Confirm the key works:

```bash
npm run ai:check
```

The notes status should read `groq`. A report response also carries
`provider: "groq"` and the model that answered.

---

## 6. Environment and routing

The gateway reads this environment shape:

```env
# Speech on every plan, live and final
ELEVENLABS_API_KEY=...
ELEVENLABS_STT_MODEL=scribe_v3

# Reports, notes and naming
GROQ_API_KEY=gsk_...
GROQ_NOTES_MODEL=openai/gpt-oss-120b

# Speech fallbacks, used only when Scribe is not configured
GROQ_STT_MODEL=whisper-large-v3

# Long recordings
WHISPER_BASE_URL=https://your-worker.example.com/v1
WHISPER_API_KEY=choose-a-long-random-token
WHISPER_MODEL=Systran/faster-whisper-small

# Optional fallbacks
OPENROUTER_API_KEY=sk-or-v1-...
# Optional: pin a specific model instead of the free chain.
# OPENROUTER_NOTES_MODEL=google/gemma-4-31b-it:free
# OPENROUTER_MEMORY_MODEL=google/gemma-4-31b-it:free
XAI_API_KEY=...
XAI_STT_MODEL=grok-voice-transcribe-2.0
XAI_NOTES_MODEL=grok-4.7
```

Routing:

1. Speech → ElevenLabs Scribe v3 for live chunks and the full recording when its
   key is set. Speaker labels are asked for on every capture except a voice note,
   and roster names and room vocabulary are sent as keyterms on every plan.
   Without Scribe, Groq (`/openai/v1/audio/transcriptions`) reads the audio,
   then the Speaches worker. If a fallback provider is not configured or fails,
   the gateway tries the next one, then xAI.
2. Live captions → Scribe in chunks of about five seconds, revealed a word at a
   time on screen. A segment closes at the first gap in speech after the five
   second mark, up to a 6.2 second hard cap, so a word is not sliced in half. A
   chunk whose loudest sample never rises above the speech gate is not sent, so
   silence costs nothing on the live pass. The browser speech service still runs
   as a web preview, and Groq turbo is the live fallback when Scribe is not
   configured.
3. Reports, notes, session asks, naming and the pre-meeting brief → Groq
   GPT-OSS `openai/gpt-oss-120b`, then `openai/gpt-oss-20b`, then OpenRouter
   free `google/gemma-4-31b-it:free` and the `openrouter/free` router, then xAI.
   Organisation memory answers follow the same order. Set
   `JOTBOX_NOTES_PROVIDER` to force one provider ahead of the rest.
   If none are configured, the app writes notes on the device from the spoken
   words and jottings.
4. `JOTBOX_AI_MOCK=1` runs the deterministic demo provider locally. It is ignored
   on Vercel so demo content cannot reach production.

Check the active chain at any time:

```bash
npm run ai:check   # configured providers
npm run ai:test    # real transcription + notes against the sample
npm run ai:demo    # same flow, local demo, no network
```

**Important Vercel limit:** a normal Vercel Function request is capped around
4.5 MB, so `/api/transcribe` accepts short clips only. For long recordings, choose
one of:

- browser uploads the audio directly to the worker using a short-lived signed
  token issued by a Vercel function; or
- use Vercel Blob/S3: browser uploads to storage, the function passes the URL to
  Groq/worker; or
- run the whole API on a small long-running host (Railway/Render/Fly) instead of
  Vercel Functions.

For the first production version, the simplest is a small Railway service that
hosts both the JotBox API and the Whisper worker, with Vercel serving the PWA.

---

## 7. Tuning speech for English and Pidgin

There are two different jobs here, and only one of them is fine-tuning.

**Hosted speech (Scribe, Groq, xAI) cannot be fine-tuned.** Use decoding and
context controls instead. They are already wired into `/api/transcribe`:

| Control | Environment | What it does |
| --- | --- | --- |
| Model | `GROQ_STT_MODEL`, `XAI_STT_MODEL` | `whisper-large-v3` is more accurate than `turbo` on accented, noisy rooms; `turbo` is faster and cheaper |
| Live model | `GROQ_LIVE_STT_MODEL` | The Groq model used for live chunks only when Scribe is not configured. Defaults to `whisper-large-v3-turbo` because it trades accuracy for latency. Scribe reads live chunks otherwise |
| Language | `JOTBOX_STT_LANGUAGE` | `en` is correct for English **and** Nigerian Pidgin, because Pidgin is English-lexified. `auto` omits the language token and lets the model guess; use it only for genuinely other-language meetings |
| Vocabulary | `JOTBOX_STT_VOCAB` | Comma, semicolon, or newline separated names, places, products and Pidgin spellings. On Groq and the worker the gateway adds them to the speech prompt, which biases spelling without changing the audio. Scribe receives them as keyterms on every plan, on the final pass |
| Prompt | `JOTBOX_STT_PROMPT` | Replaces the built-in verbatim/Pidgin prompt sent to Groq and the worker. Scribe takes no prompt, so this does not affect it. Leave unset unless you have a specific reason |
| Temperature | fixed at `0` | Keeps transcription deterministic and discourages the model from "tidying" Pidgin |
| Noise cut | `JOTBOX_STT_NO_SPEECH`, `JOTBOX_STT_LOGPROB`, `JOTBOX_STT_COMPRESSION` | Segment-level confidence thresholds on Groq and the worker. Segments above the no-speech cut, below the log-probability cut, or with an unusually high compression ratio are dropped before the words reach the notes. Defaults are `0.65`, `-1` and `2.4` |
| Worker VAD | `JOTBOX_STT_WORKER_TUNING` | On by default. Sends faster-whisper VAD and `condition_on_previous_text=false` to the self-hosted worker, which stops long recordings from drifting into repeated or invented text. Set to `off` only for a worker that rejects those fields |

Every capture also sends a short per-session context header (`x-jotbox-stt-context`)
with the session title, roster names and focus mode. Groq and the worker receive
it as speech-prompt context; Scribe receives the roster and the room vocabulary
as keyterms on the final pass, on every plan, and the naming pass assigns names
after transcription. The browser's **Session
focus** (`off`, `balanced`, `strict`) then drops clear asides before the notes
are written.

**Pickup** (`balanced`, `far voices`) changes both the microphone constraints and
the audio conditioning. In both modes the recorded stream passes through a
high-pass filter (removes desk rumble and generator hum), a dynamics compressor
and a makeup gain, so a person across the table and a person beside the laptop
reach Scribe at a similar level. `balanced` keeps browser noise suppression on
and uses a gentler profile. `far voices` turns noise suppression off, lowers the
compressor threshold and adds more makeup gain, because aggressive noise
suppression can swallow a soft, distant speaker.

The conditioning is real Web Audio processing, not a post-recording volume
change, and it applies to both microphone-only captures and the mic plus tab
audio mix. Both are available in capture setup and Settings.

Example:

```env
JOTBOX_STT_LANGUAGE=en
JOTBOX_STT_VOCAB=JotBox, Ibadan, Abuja, GTBank, NIPOST, wetin dey, no wahala, make we
# Groq fallback models, used only when Scribe is not configured
GROQ_STT_MODEL=whisper-large-v3
GROQ_LIVE_STT_MODEL=whisper-large-v3-turbo
# Keep more faint speech: raise the no-speech cut toward 0.75.
# Drop more room noise: lower it toward 0.55.
# JOTBOX_STT_NO_SPEECH=0.65
```

Keep the vocabulary under about 60 terms when Scribe is absent. Groq's prompt
is a short context hint, not a dictionary; a long list crowds out the actual
audio context. It is also the right place for Nigerian names, towns and
workplace acronyms that the room shortens in speech. With Scribe configured,
the same names go to the final pass as keyterms on every plan, capped at 100.

Groq rejects a speech prompt longer than **896 characters** with
`invalid_prompt`, and that rejection happens before the audio is decoded. The
gateway keeps the full prompt inside that budget: the instruction text is capped,
then names and vocabulary are added one term at a time until the space is full.
A request that is too long fails the whole recording, so do not raise the cap.
This limit applies only when Groq is reading the recording.

### Audio before the model

The order is deliberate: condition the room, then transcribe, then edit.

1. **Browser capture.** `getUserMedia` asks for `echoCancellation` and
   `autoGainControl` in every mode. `noiseSuppression` is on for `balanced` and
   off for `far voices`.
2. **Web Audio conditioning.** `apps/web/src/lib/audioConditioning.ts` adds the
   high-pass, compressor and makeup gain described above. If the browser cannot
   start an `AudioContext`, the raw microphone is used instead.
3. **Voice activity detection.** The self-hosted Speaches / `faster-whisper`
   worker receives `vad_filter=true` with a 0.35 threshold, 350 ms silence and
   400 ms speech padding. This removes dead air and stops the model inventing
   words during silence. Vercel cannot run an ffmpeg binary, so the hosted paths
   rely on provider-side no-speech handling, plus the Groq segment filters in
   the gateway.
4. **Prompt conditioning (Groq and the worker).** The speech prompt names Pidgin,
   code-switching, soft, fast and distant speech, and asks for local names and
   acronyms to keep their spelling. Scribe takes no prompt; it auto-detects the
   English/Pidgin mix.
5. **The editor.** The notes model reads idioms, proverbs, sarcasm and
   understatement for their intent, keeps Pidgin quotes, and drops greetings,
   football, lunch orders and side jokes unless they change a decision.

If you run the worker yourself and want a second loudness stage, put
`ffmpeg -af dynaudnorm` or `loudnorm` in front of Speaches, or add the same
filter to the proxy that forwards audio to it. Do not add that step to the
browser: the Web Audio conditioning already runs in real time and a second
compression pass can pump the room tone.

Do not add a post-processing step that rewrites Pidgin into standard English.
The transcript is evidence for the memory layer, so it stays verbatim. The
notes prompt may explain the intent of a Pidgin line in clear English, but it
keeps the original words in quotation marks rather than flattening the room.

### Fine-tuning a self-hosted worker

Fine-tuning belongs on the Speaches / `faster-whisper` worker, where you control
the weights. The gateway already sends `WHISPER_MODEL` to the worker, so a
tuned checkpoint only needs a model id the worker can load.

1. **Collect real audio with consent.** Meetings and voice notes from the same
   microphones, accents and code-switching mix are worth more than generic
   read speech. Keep transcripts verbatim, including Pidgin spelling.
2. **Start from an existing checkpoint.** Look for Pidgin or Nigerian-English
   Whisper checkpoints on Hugging Face (for example `michaelodafe/whisper-pidgin-v1`)
   and the [NaijaVoices dataset](https://arxiv.org/html/2505.20564v1) for
   training and evaluation data. Treat public WER numbers as a starting point,
   not a promise: evaluate on your own rooms.
3. **Fine-tune with LoRA or full fine-tuning.** A LoRA run on a single free GPU
   is enough to specialise spelling and accents; full fine-tuning needs more
   data and compute. Keep a held-out set that includes both English and Pidgin.
4. **Measure word error rate on both languages separately.** A model that wins
   on Pidgin but loses on English is not a win for a mixed room. Track names,
   numbers, dates and Pidgin function words (`wetin`, `dey`, `na`, `sha`, `abeg`)
   as their own error buckets.
5. **Serve it through Speaches.** Put the checkpoint where the worker can load
   it, convert to CTranslate2 if needed, then point the gateway at it:

   ```env
   WHISPER_MODEL=your-org/whisper-pidgin-ct2
   ```

   Preload it in `worker/docker-compose.yml` (`PRELOAD_MODELS`) so the first
   meeting does not wait for a download.
6. **Keep the vocabulary prompt.** Even a tuned model benefits from room-specific
   names and product spellings.
7. **Roll out behind a switch.** Run the tuned worker alongside the current one
   and compare transcripts on the same recordings before changing production.

If you later move to a provider that supports custom models, the request shape
stays the same: model, language, prompt, temperature `0`.

---

## 8. Security checklist

- `API_KEY` is set on the worker; never ship it in the browser bundle.
- Worker is HTTPS-only; port 8000 is not publicly exposed when a reverse proxy is
  used.
- Limit upload size and request time; delete temp files after transcription.
- Rate-limit by user/device in the JotBox API before calling a provider.
- Keep provider keys in Vercel Environment Variables (Production, Preview,
  Development separately).
- Do not log raw audio URLs or bearer tokens.
- Check Groq/xAI terms for data retention before sending confidential meetings.
