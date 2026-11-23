# Audio storage

JotBox keeps the original recording in a private S3-compatible bucket. Cloudflare R2 is the default. The bucket powers playback, re-transcription from the stored file, the async job queue, and the retention sweep.

## What breaks without it

`/api/health` reports `"storage": false`. In that state:

- Audio upload returns 503 and `has_audio` stays false.
- The client falls back to sending the whole recording to `/api/transcribe`.
- Vercel caps a request body at roughly 4.5 MB, so long sessions fail and only short clips finish.
- Playback, retention, and storage-backed transcription jobs are inactive.

The app still writes notes from the live transcript, which is why the fallback hides the problem for short meetings.

## Cloudflare R2 setup

1. In the Cloudflare dashboard, open R2 and create a **private** bucket, for example `jotbox-audio`.
2. Open **Manage R2 API Tokens**, create a token with **Object Read & Write** scoped to that bucket. Note the Account ID, Access Key ID, and Secret Access Key. R2 shows the secret once.
3. Add a CORS rule so the browser can upload straight to the bucket. Replace the preview origin with your Vercel project domain if it differs.

   ```json
   [
     {
       "AllowedOrigins": ["https://jotbox.online", "https://*.vercel.app"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["etag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Without this rule the direct PUT is refused. Short clips still take the server path, but long recordings need the direct upload.

4. Add the four values to Vercel for Production, Preview, and Development. The CLI prompts for each value, so nothing is pasted into a shell argument.

   ```bash
   npx vercel env add R2_ACCOUNT_ID production
   npx vercel env add R2_BUCKET production
   npx vercel env add R2_ACCESS_KEY_ID production
   npx vercel env add R2_SECRET_ACCESS_KEY production
   ```

   Repeat with `preview` and `development`. `R2_REGION` defaults to `auto`. For another S3 provider, set `R2_ENDPOINT`, or use the equivalent `S3_*` names from `.env.example`.

5. Put the same names in your local `.env`, then run the round-trip check. It writes one small object under `checks/`, reads it back, and deletes it.

   ```bash
   npm run storage:check
   ```

6. Redeploy and confirm the deployment sees the bucket.

   ```bash
   curl -s https://jotbox.online/api/health
   ```

   The response should include `"storage": true`.

## Retention

`JOTBOX_AUDIO_RETENTION_DAYS` defaults to 30 days and `0` disables the sweep. Organisation retention windows filter what appears in memory, and the sweep deletes stored audio after the window passes. The bucket itself stays private. Playback uses short-lived presigned GETs.
