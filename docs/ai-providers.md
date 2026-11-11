# AI providers: Groq and a self-hosted Whisper worker

This guide is the recommended rollout for JotBox's studio features:

| Path | Use it for | Cost | Limits |
| --- | --- | --- | --- |
| Browser Web Speech + local notes | Live captions and draft notes | Free | Mic only, no tab/upload transcription, no diarisation |
| Groq Whisper | Short recordings and calls | Free tier, then paid | 25 MB per file on the free tier |
| Speaches + faster-whisper | Long lectures, offline/low-bandwidth setups | Your compute | Model size and CPU/GPU decide speed |
| xAI | One-key premium STT + notes | Paid | Provider pricing and rate limits |

The app currently runs in **Draft mode** in production. The steps below prepare the
providers; wiring them into `/api/transcribe` and `/api/enhance` is the next code
step.

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
   GROQ_NOTES_MODEL=llama-3.3-70b-versatile
   ```

6. Add it to Vercel when the endpoints are ready:

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

## 4. Wire it into JotBox

The intended environment shape:

```env
# Short clips
GROQ_API_KEY=gsk_...
GROQ_STT_MODEL=whisper-large-v3-turbo

# Long recordings
WHISPER_BASE_URL=https://your-worker.example.com/v1
WHISPER_API_KEY=choose-a-long-random-token
WHISPER_MODEL=Systran/faster-whisper-small

# Notes
GROQ_NOTES_MODEL=llama-3.3-70b-versatile
```

Routing rule:

1. Audio under 20 MB → Groq (`/openai/v1/audio/transcriptions`).
2. Larger audio → Speaches worker (`/v1/audio/transcriptions`).
3. Notes → Groq chat completions or the existing xAI prompt.

**Important Vercel limit:** a normal Vercel Function request is capped around
4.5 MB, so simply porting `/api/transcribe` will still reject long recordings.
For production, choose one of:

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
