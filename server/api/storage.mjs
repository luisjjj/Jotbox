import crypto from "node:crypto";
import { query } from "./pg.mjs";

/**
 * Audio retention on any S3-compatible store (Cloudflare R2 by default).
 *
 * Signing is done here rather than with an SDK so the serverless bundle stays
 * small. The bucket is private; playback uses a short-lived presigned GET.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_SWEEP = 200;

const MIME_EXTENSION = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "video/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

function key(name) {
  return String(process.env[name] || "").trim();
}

export function storageConfig() {
  const bucket = key("R2_BUCKET") || key("S3_BUCKET");
  const accessKeyId = key("R2_ACCESS_KEY_ID") || key("S3_ACCESS_KEY_ID");
  const secretAccessKey = key("R2_SECRET_ACCESS_KEY") || key("S3_SECRET_ACCESS_KEY");
  const account = key("R2_ACCOUNT_ID");
  const endpoint =
    key("R2_ENDPOINT") ||
    key("S3_ENDPOINT") ||
    (account ? `https://${account}.r2.cloudflarestorage.com` : "");
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/+$/, ""),
    region: key("R2_REGION") || key("S3_REGION") || "auto",
  };
}

export function storageConfigured() {
  return storageConfig() !== null;
}

export function audioExtension(contentType) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  return MIME_EXTENSION[type] || "bin";
}

export function audioKeyFor(userId, captureId, contentType) {
  return `audio/${userId}/${captureId}.${audioExtension(contentType)}`;
}

export function retentionDays(env = process.env) {
  const raw = Number(env.JOTBOX_AUDIO_RETENTION_DAYS);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(Math.round(raw), 3650);
  return DEFAULT_RETENTION_DAYS;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(keyBytes, value, encoding) {
  return crypto.createHmac("sha256", keyBytes).update(value).digest(encoding);
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function encodeQuery(params) {
  return Object.entries(params)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
}

function amzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function scopeDate(stamp) {
  return stamp.slice(0, 8);
}

function signingKey(secret, date, region, service = "s3") {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function signature(secret, date, region, stringToSign) {
  return hmac(signingKey(secret, date, region), stringToSign, "hex");
}

function canonicalUri(config, objectKey) {
  return `${new URL(config.endpoint).pathname.replace(/\/+$/, "")}/${encodePath(config.bucket)}/${encodePath(objectKey)}`;
}

function objectUrl(config, objectKey) {
  return `${config.endpoint}${canonicalUri(config, objectKey)}`;
}

async function signedRequest(method, objectKey, { body, contentType } = {}) {
  const config = storageConfig();
  if (!config) throw Object.assign(new Error("Audio storage is not configured."), { status: 503 });
  const stamp = amzDate();
  const date = scopeDate(stamp);
  const payloadHash = body ? sha256Hex(body) : sha256Hex("");
  const host = new URL(config.endpoint).host;
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}`).join("\n") + "\n";
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    canonicalUri(config, objectKey),
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, `${date}/${config.region}/s3/aws4_request`, sha256Hex(canonicalRequest)].join("\n");
  const auth = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${date}/${config.region}/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature(config.secretAccessKey, date, config.region, stringToSign)}`;

  const response = await fetch(objectUrl(config, objectKey), {
    method,
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
      Authorization: auth,
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  return { response, config };
}

export async function putAudio(objectKey, body, contentType) {
  const { response } = await signedRequest("PUT", objectKey, { body, contentType });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error(`Audio upload failed (${response.status}).`), {
      status: 502,
      detail: detail.slice(0, 300),
    });
  }
  return { key: objectKey, bytes: body.length };
}

export async function getAudio(objectKey) {
  const { response } = await signedRequest("GET", objectKey);
  if (!response.ok) {
    throw Object.assign(new Error(`Audio download failed (${response.status}).`), { status: 502 });
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

/** Confirms a browser upload landed, without pulling the bytes back. */
export async function headAudio(objectKey) {
  const { response } = await signedRequest("HEAD", objectKey);
  if (!response.ok) return null;
  return {
    bytes: Number(response.headers.get("content-length")) || 0,
    contentType: response.headers.get("content-type") || "",
  };
}

export async function deleteAudioObject(objectKey) {
  const { response } = await signedRequest("DELETE", objectKey);
  // A missing object is already deleted.
  if (!response.ok && response.status !== 404) {
    throw Object.assign(new Error(`Audio delete failed (${response.status}).`), { status: 502 });
  }
}

/**
 * Short-lived GET for playback, or PUT for a browser upload that skips the
 * function body limit. A PUT signs the exact content type the browser sends.
 */
export function presignAudio(objectKey, expiresSeconds = 600, { method = "GET", contentType = "" } = {}) {
  const config = storageConfig();
  if (!config) throw Object.assign(new Error("Audio storage is not configured."), { status: 503 });
  const verb = method === "PUT" ? "PUT" : "GET";
  const stamp = amzDate();
  const date = scopeDate(stamp);
  const expires = Math.max(60, Math.min(Math.round(expiresSeconds), 3600));
  const host = new URL(config.endpoint).host;
  const signedHeaders = verb === "PUT" && contentType ? "host;content-type" : "host";
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${date}/${config.region}/s3/aws4_request`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = encodeQuery(params);
  const canonicalHeaders =
    verb === "PUT" && contentType ? `host:${host}\ncontent-type:${contentType}\n` : `host:${host}\n`;
  const canonicalRequest = [
    verb,
    canonicalUri(config, objectKey),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, `${date}/${config.region}/s3/aws4_request`, sha256Hex(canonicalRequest)].join("\n");
  const signed = signature(config.secretAccessKey, date, config.region, stringToSign);
  return {
    url: `${objectUrl(config, objectKey)}?${canonicalQuery}&X-Amz-Signature=${signed}`,
    expiresAt: Date.now() + expires * 1000,
  };
}

/**
 * Removes audio past the retention window. The notes, transcript and ledger
 * rows stay. The daily billing reconciliation calls this.
 */
export async function sweepExpiredAudio({ now = Date.now() } = {}) {
  if (!storageConfigured()) return { deleted: 0, checked: 0 };
  const days = retentionDays();
  if (!days) return { deleted: 0, checked: 0 };
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  const rows = await query(
    `select id, audio_key
       from captures
      where audio_key is not null
        and created_at < $1
      order by created_at
      limit ${MAX_SWEEP}`,
    [cutoff],
  );
  let deleted = 0;
  for (const row of rows.rows) {
    try {
      await deleteAudioObject(row.audio_key);
      await query(
        `update captures
            set audio_key = null, has_audio = false, audio_deleted_at = now()
          where id = $1`,
        [row.id],
      );
      deleted += 1;
    } catch (error) {
      console.warn("[jotbox-storage] audio sweep skipped", row.id, error instanceof Error ? error.message : error);
    }
  }
  return { deleted, checked: rows.rows.length };
}
