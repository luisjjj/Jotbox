/**
 * Deterministic speech routing.
 *
 * The plan and the recording mode decide the provider before any audio is
 * sent, so a free capture can never drift onto a paid model and a group
 * meeting always gets speaker labels on a paid plan. Prices are public list
 * prices per hour of audio and are used only to estimate spend.
 */

export const STT_PRICES = {
  "groq-turbo": 0.04,
  "groq-large": 0.111,
  scribe: 0.22,
  "scribe-keyterms": 0.27,
};

export const GROUP_KINDS = new Set(["meeting", "seminar"]);
export const RECORDING_MODES = new Set(["lecture", "group"]);

export function normalizePlan(plan) {
  return plan === "pro" || plan === "enterprise" ? plan : "free";
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
 * Decide the provider for one full recording. `available` is filled from the
 * server keys; a rule is still returned when its first choice is missing so
 * the caller can see what was intended and which fallback ran.
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

  const finish = (rule, reason) => ({
    tier,
    mode: selectedMode,
    reason,
    ...rule,
  });

  // Igbo is not on Whisper's hosted language list. A self-hosted Igbo reader
  // wins; otherwise Scribe is the only provider that can read it.
  if (language === "ig") {
    if (hasWorker) return finish(workerRoute({}), "Igbo needs the self-hosted reader.");
    if (hasScribe) {
      const price = tier === "enterprise" ? STT_PRICES["scribe-keyterms"] : STT_PRICES.scribe;
      return finish(
        scribeRoute({
          keyterms: tier === "enterprise" ? terms : [],
          diarize: tier === "enterprise" || selectedMode === "group",
          price,
        }),
        "Igbo is not on Groq, so Scribe reads it.",
      );
    }
    if (hasGroq) {
      return finish(
        groqRoute({ model: "whisper-large-v3", price: STT_PRICES["groq-large"], fallback: true }),
        "The Igbo reader is not configured; Groq is the only reader left.",
      );
    }
  }

  if (tier === "enterprise") {
    const rule = hasScribe
      ? scribeRoute({ keyterms: terms, diarize: true, price: STT_PRICES["scribe-keyterms"] })
      : groqRoute({
          model: "whisper-large-v3",
          price: STT_PRICES["groq-large"],
          fallback: true,
          requestedProvider: "elevenlabs",
        });
    return finish(rule, "Enterprise keeps speaker labels and the organisation glossary.");
  }

  if (tier === "pro") {
    if (selectedMode === "group") {
      const rule = hasScribe
        ? scribeRoute({ keyterms: [], diarize: true, price: STT_PRICES.scribe })
        : groqRoute({
            model: "whisper-large-v3",
            price: STT_PRICES["groq-large"],
            fallback: true,
            requestedProvider: "elevenlabs",
          });
      return finish(rule, "Group meetings keep speaker labels on Scribe without paid keyterms.");
    }
    const rule = hasGroq
      ? {
          ...groqRoute({ model: "whisper-large-v3", price: STT_PRICES["groq-large"] }),
          prompt: "glossary",
        }
      : scribeRoute({
          keyterms: [],
          diarize: false,
          price: STT_PRICES.scribe,
          fallback: true,
          requestedProvider: "groq",
        });
    return finish(rule, "Lecture and solo notes use Groq large with the personal glossary.");
  }

  if (hasGroq) {
    return finish(
      {
        ...groqRoute({ model: "whisper-large-v3-turbo", price: STT_PRICES["groq-turbo"] }),
        prompt: "language",
      },
      "Free captures stay on Groq turbo with no glossary keyterms or speaker labels.",
    );
  }

  if (hasScribe) {
    return finish(
      scribeRoute({
        keyterms: [],
        diarize: false,
        price: STT_PRICES.scribe,
        fallback: true,
        requestedProvider: "groq",
      }),
      "Groq is not configured, so the free capture falls back to Scribe.",
    );
  }
  if (hasWorker) return finish(workerRoute({ fallback: true, requestedProvider: "groq" }), "Groq is not configured.");
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
        requestedProvider: "groq",
      },
      "Groq is not configured.",
    );
  }
  if (hasDemo) {
    return finish(
      {
        provider: "demo",
        model: "demo",
        diarize: true,
        prompt: "none",
        keyterms: [],
        costPerHour: 0,
        costKey: "demo",
        fallback: true,
        requestedProvider: "groq",
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
      requestedProvider: "groq",
    },
    "No speech provider is configured.",
  );
}

/**
 * Live captions are a disposable preview and always stay on a reader that can
 * turn a short chunk around quickly. Batch Scribe is the slowest option here,
 * so it is used only when no faster reader is configured.
 */
export function routeLiveTranscription({ available = {} } = {}) {
  if (available.groq !== false) {
    return {
      provider: "groq",
      model: "whisper-large-v3-turbo",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: STT_PRICES["groq-turbo"],
      costKey: "groq-turbo",
      fallback: false,
      requestedProvider: "groq",
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
      requestedProvider: "groq",
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
      requestedProvider: "groq",
    };
  }
  if (available.scribe !== false) {
    return {
      provider: "elevenlabs",
      model: "scribe_v3",
      diarize: false,
      prompt: "none",
      keyterms: [],
      costPerHour: STT_PRICES.scribe,
      costKey: "scribe",
      fallback: true,
      requestedProvider: "groq",
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
      requestedProvider: "groq",
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
    requestedProvider: "groq",
  };
}

export function estimatedCost(seconds, costPerHour) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const rate = Number(costPerHour);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Number(((safeSeconds / 3600) * rate).toFixed(4));
}
