/**
 * Small OpenAI-compatible embeddings adapter.
 *
 * Any provider that speaks the `/embeddings` shape works: OpenAI, a local
 * gateway, or a hosted clone. When it is not configured or fails, callers fall
 * back to lexical retrieval, so memory search keeps working without a vector
 * service.
 */

const DEFAULT_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const MAX_INPUTS = 128;
const MAX_CHARS = 8_000;

function key(name) {
  return String(process.env[name] || "").trim();
}

export function embeddingsConfig() {
  const explicit = key("JOTBOX_EMBEDDINGS_URL");
  const apiKey = key("JOTBOX_EMBEDDINGS_API_KEY") || key("OPENAI_API_KEY");
  const url = explicit || (apiKey ? DEFAULT_URL : "");
  if (!url) return null;
  return {
    url: /\/embeddings$/.test(url) ? url : `${url.replace(/\/+$/, "")}/embeddings`,
    apiKey,
    model: key("JOTBOX_EMBEDDINGS_MODEL") || DEFAULT_MODEL,
    dimensions: Number(key("JOTBOX_EMBEDDINGS_DIMENSIONS")) || DEFAULT_DIMENSIONS,
  };
}

export function embeddingsConfigured() {
  return embeddingsConfig() !== null;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = Number(a[index]) || 0;
    const y = Number(b[index]) || 0;
    dot += x * y;
    left += x * x;
    right += y * y;
  }
  if (!left || !right) return 0;
  return dot / (Math.sqrt(left) * Math.sqrt(right));
}

export function vectorLiteral(vector) {
  return `[${vector.map((value) => (Number.isFinite(value) ? Number(value).toFixed(7) : "0")).join(",")}]`;
}

async function requestBatch(config, texts) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`embeddings failed (${response.status}) ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .sort((a, b) => Number(a?.index) - Number(b?.index))
    .map((row) => (Array.isArray(row?.embedding) ? row.embedding.map(Number) : null));
}

export async function embedTexts(inputs) {
  const config = embeddingsConfig();
  if (!config || !Array.isArray(inputs) || !inputs.length) return null;
  const texts = inputs.slice(0, MAX_INPUTS).map((text) => String(text ?? "").slice(0, MAX_CHARS));
  try {
    const vectors = [];
    for (let index = 0; index < texts.length; index += 64) {
      const batch = await requestBatch(config, texts.slice(index, index + 64));
      vectors.push(...batch);
    }
    if (vectors.length !== texts.length) return null;
    for (const vector of vectors) {
      if (!vector || vector.length !== config.dimensions) return null;
    }
    return vectors;
  } catch (error) {
    console.warn("[jotbox-embeddings]", error instanceof Error ? error.message : error);
    return null;
  }
}
