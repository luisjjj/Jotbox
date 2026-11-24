/**
 * Deterministic speech routing.
 *
 * The plan and the recording mode decide the provider before any audio is
 * sent, so a free capture can never drift onto a paid model. Every capture
 * except a voice note asks for speaker labels, and names ride along as
 * keyterms, because a wrong name is the mistake a listener notices first.
 * Prices are public list prices per hour of audio and are used only to
 * estimate spend.
 */

export const STT_PRICES = {
  "groq-turbo": 0.04,
  "groq-large": 0.111,
  scribe: 0.2,
  "scribe-keyterms": 0.25,
};

export const GROUP_KINDS = new Set(["meeting", "seminar"]);
export const RECORDING_MODES = new Set(["lecture", "group"]);

export function normalizePlan(plan) {
  if (plan === "enterprise") return "enterprise";
  if (plan === "pro" || plan === "starter" || plan === "power") return "pro";
  return "free";
}

export function modeForKind(kind) {
  return GROUP_KINDS.has(kind) ? "group" : "lecture";
}

function cleanTerms(terms, limit = 100) {
  const seen = new Set();
  const picked = [];
  for (const term of Array.isArray(terms) ? terms : []) {
    const clean = String(term ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
    if (clean.length < 2) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(clean);
    if (picked.length >= limit) break;
  }
  return picked;
}

function groqRoute({ model, price, fallback = false, requestedProvider = "groq" }) {
  return {
    provider: "groq",
    model,
    diarize: false,
    prompt: "none",
    keyterms: [],
    costPerHour: price,
    costKey: model === "whisper-large-v3-turbo" ? "groq-turbo" : "groq-large",
    fallback,
    requestedProvider,
  };
}

function scribeRoute({ keyterms = [], diarize = true, price, fallback = false, requestedProvider = "elevenlabs" }) {
  return {
    provider: "elevenlabs",
    model: "scribe_v3",
    diarize,
    prompt: "none",
    keyterms: cleanTerms(keyterms),
    costPerHour: price,
    costKey: price >= STT_PRICES["scribe-keyterms"] ? "scribe-keyterms" : "scribe",
    fallback,
    requestedProvider,
  };
}

function workerRoute({ fallback = false, requestedProvider = "worker" }) {
  return {
    provider: "worker",
    model: "self-hosted",
    diarize: false,
    prompt: "glossary",
    keyterms: [],
    costPerHour: 0,
    costKey: "self-hosted",
    fallback,
    requestedProvider,
  };
}

/**
 * Decide the provider for one full recording. Scribe is the reader on every
 * plan because the free tier is the demo that has to earn the upgrade. Groq
 * and the self-hosted worker stay as fallbacks. Every kind except a voice
 * note asks for speaker labels, and the names and room words in `glossary`
 * are sent as keyterms on every plan: a name read wrong is the mistake that
 * costs a student notes, and diarization carries no extra per-hour charge.
 *
 * `available` is filled from the server keys; a rule is still returned when
 * its first choice is missing so the caller can see what was intended and
 * which fallback ran.
 */
export function routeTranscription({
  plan = "free",
  mode,
  kind = "meeting",
  language = "en",
  glossary = [],
  available = {},
} = {}) {
  const tier = normalizePlan(plan);
  const selectedMode = RECORDING_MODES.has(mode) ? mode : modeForKind(kind);
  const hasGroq = available.groq !== false;
  const hasScribe = available.scribe !== false;
  const hasWorker = available.worker === true;
  const hasXai = available.xai === true;
  const hasDemo = available.demo === true;
  const terms = cleanTerms(glossary);
  // A voice note has one speaker by definition, so labels would only add
  // noise. Lectures can still carry a lecturer and questions from the room.
  const diarize = kind !== "voice";

  const finish = (rule, reason) => ({
    tier,
    mode: selectedMode,
    reason,
    ...rule,
  });

  const scribeForPlan = () =>
    scribeRoute({
      keyterms: terms,
      diarize,
      // Scribe charges the keyterm rate only when a keyterm list is sent.
      price: terms.length ? STT_PRICES["scribe-keyterms"] : STT_PRICES.scribe,
    });

  // Igbo is not on Whisper's hosted language list, and Scribe reads it. The
  // worker is the fallback only when Scribe is not configured.
  if (language === "ig" && hasScribe) {
    return finish(scribeForPlan(), "Scribe reads Igbo on every plan.");
  }

  if (hasScribe) {
    return finish(
      scribeForPlan(),
      tier === "enterprise"
        ? "Scribe reads with the organisation glossary and labels speakers."
        : "Scribe reads on every plan, with names boosted and speakers labelled.",
    );
  }

  if (hasWorker && language === "ig") {
    return finish(
      workerRoute({ fallback: true, requestedProvider: "elevenlabs" }),
      "Scribe is not configured, so the self-hosted reader runs Igbo.",
    );
  }

  if (hasGroq) {
    return finish(
      {
        ...groqRoute({
          model: "whisper-large-v3",
          price: STT_PRICES["groq-large"],
          fallback: true,
          requestedProvider: "elevenlabs",
        }),
        prompt: "glossary",
      },
      "Scribe is not configured, so Groq reads the recording.",
    );
  }

  if (hasWorker) {
    return finish(
      workerRoute({ fallback: true, requestedProvider: "elevenlabs" }),
      "Scribe is not configured, so the self-hosted reader runs.",
    );
  }

  if (hasXai) {
    return finish(
      {
        provider: "xai",
        model: "grok-voice-transcribe-2.0",
        diarize: false,
        prompt: "language",
        keyterms: [],
        costPerHour: 0,
        costKey: "xai",
        fallback: true,
        requestedProvider: "elevenlabs",
      },
      "Neither Scribe nor Groq is configured, so xAI reads the recording.",
    );
  }

  if (hasDemo) {
    return finish(
      {
        provider: "demo",
        model: "demo",
        diarize: false,
        prompt: "none",
        keyterms: [],
        costPerHour: 0,
        costKey: "demo",
        fallback: true,
        requestedProvider: "elevenlabs",
      },
      "No speech provider is configured, so the demo reader is used.",
    );
  }

  return finish(
    {
      provider: "none",
      model: "none",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: 0,
      costKey: "none",
      fallback: true,
      requestedProvider: "elevenlabs",
    },
    "No speech provider is configured.",
  );
}

/**
 * Live captions use the same Scribe reader as the final pass so a free
 * listener hears the accuracy they are deciding to pay for. Scribe bills the
 * same audio again for the live pass. Groq turbo and the worker are fallbacks
 * only, used when Scribe is not configured.
 */
export function routeLiveTranscription({ available = {} } = {}) {
  if (available.scribe !== false) {
    return {
      provider: "elevenlabs",
      model: "scribe_v3",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: STT_PRICES.scribe,
      costKey: "scribe",
      fallback: false,
      requestedProvider: "elevenlabs",
    };
  }
  if (available.groq !== false) {
    return {
      provider: "groq",
      model: "whisper-large-v3-turbo",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: STT_PRICES["groq-turbo"],
      costKey: "groq-turbo",
      fallback: true,
      requestedProvider: "elevenlabs",
    };
  }
  if (available.worker === true) {
    return {
      provider: "worker",
      model: "self-hosted",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: 0,
      costKey: "self-hosted",
      fallback: true,
      requestedProvider: "elevenlabs",
    };
  }
  if (available.xai === true) {
    return {
      provider: "xai",
      model: "grok-voice-transcribe-2.0",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: 0,
      costKey: "xai",
      fallback: true,
      requestedProvider: "elevenlabs",
    };
  }
  if (available.demo === true) {
    return {
      provider: "demo",
      model: "demo",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: 0,
      costKey: "demo",
      fallback: true,
      requestedProvider: "elevenlabs",
    };
  }
  return {
    provider: "none",
    model: "none",
    diarize: false,
    prompt: "none",
    keyterms: [],
    costPerHour: 0,
    costKey: "none",
    fallback: true,
    requestedProvider: "elevenlabs",
  };
}

export function estimatedCost(seconds, costPerHour) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const rate = Number(costPerHour);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Number(((safeSeconds / 3600) * rate).toFixed(4));
}
