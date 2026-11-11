# AI providers: Groq and a self-hosted Whisper worker

This guide covers the provider chain already wired into `/api/transcribe` and
`/api/enhance`:

| Path | Use it for | Cost | Limits |
| --- | --- | --- | --- |
| Browser Web Speech + on-device notes | Live words and notes with no provider | Free | Mic only, no upload transcription, no speaker separation |
| Groq Whisper | Short recordings and calls | Free tier, then paid | 25 MB per file on the free tier |
| Speaches + faster-whisper | Long lectures, offline/low-bandwidth setups | Your compute | Model size and CPU/GPU decide speed |
| OpenRouter free model | Notes when Groq is unavailable | Free tier, rate-limited | Shared capacity and model availability |
| xAI | One-key premium speech and notes | Paid | Provider pricing and rate limits |

Routing is free first: Groq for speech and notes, the self-hosted worker for long
audio, an OpenRouter free model for notes fallback, then xAI. With no keys the app
still records, keeps live browser words, and writes notes on the device.

The prompts preserve Nigerian Pidgin and tone: Pidgin lines stay as they were said
and are quoted inside otherwise clear English notes; names, amounts, dates, and
decisions stay exact. Whisper has no Nigerian Pidgin language token, so the request
uses `language=en` with a Pidgin-aware prompt for context.

---

## 1. Get a Groq API key

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
   GROQ_STT_MODEL=whisper-large-v3-turbo
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
  -F "model=whisper-large-v3-turbo" ^
  -F "response_format=verbose_json" ^
  -F "timestamp_granularities[]=word"
```

Models:

- `whisper-large-v3-turbo` — cheapest/fastest; good for clear English.
- `whisper-large-v3` — more accurate, slower.
- Groq's free tier caps uploads at **25 MB** and does **not** provide speaker
  diarisation. Long lectures need the worker below or audio chunking.

---

## 2. Run the Whisper worker locally

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

## 3. Deploy the worker

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

## 4. Environment and routing

The gateway reads this environment shape:

```env
# Short clips and free notes
GROQ_API_KEY=gsk_...
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_NOTES_MODEL=openai/gpt-oss-120b

# Long recordings
WHISPER_BASE_URL=https://your-worker.example.com/v1
WHISPER_API_KEY=choose-a-long-random-token
WHISPER_MODEL=Systran/faster-whisper-small

# Optional fallbacks
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_NOTES_MODEL=meta-llama/llama-3.3-70b-instruct:free
XAI_API_KEY=...
XAI_STT_MODEL=grok-voice-transcribe-2.0
XAI_NOTES_MODEL=grok-4.7
```

Routing:

1. Speech → Groq (`/openai/v1/audio/transcriptions`) for clips within the free
   limit; larger files go to the Speaches worker first. If a provider is not
   configured or fails, the gateway tries the next one, then xAI.
2. Notes → Groq chat completions, then an OpenRouter free model, then xAI. If none
   are configured, the app writes notes on the device from the spoken words and
   jottings.
3. `JOTBOX_AI_MOCK=1` runs the deterministic demo provider locally. It is ignored
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

## 5. Security checklist

- `API_KEY` is set on the worker; never ship it in the browser bundle.
- Worker is HTTPS-only; port 8000 is not publicly exposed when a reverse proxy is
  used.
- Limit upload size and request time; delete temp files after transcription.
- Rate-limit by user/device in the JotBox API before calling a provider.
- Keep provider keys in Vercel Environment Variables (Production, Preview,
  Development separately).
- Do not log raw audio URLs or bearer tokens.
- Check Groq/xAI terms for data retention before sending confidential meetings.
