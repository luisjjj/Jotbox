import { chatJson, mockEnabled } from "./ai.mjs";
import { HttpError } from "./http.mjs";

/**
 * Turn one finished capture into a quiz or a flashcard deck for a study group.
 *
 * The source is the note the writer already produced, plus a slice of the
 * transcript when the note is thin. Pidgin and local phrasing stay verbatim:
 * a study set should sound like the lecture, not like a textbook.
 */

const MAX_SOURCE_CHARS = 14_000;
const MAX_TRANSCRIPT_CHARS = 7_000;

const QUIZ_SYSTEM = `You write a short quiz from one student's lecture notes so classmates can test themselves.
Rules:
- Write 6 to 8 questions with exactly four options each and one correct answer.
- Test understanding and recall of the material. Do not ask trivia about wording or formatting.
- Keep the source language and register. If the source is Pidgin, write the questions, options and explanations in Pidgin. Never translate Pidgin into formal English.
- Use only facts found in the source. Never invent names, numbers, or claims.
- "answer" is the zero-based index of the correct option.
- "explanation" is one sentence saying why the answer is right, drawn from the source.
Return only a JSON object with this exact shape:
{"questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}`;

const CARDS_SYSTEM = `You write a compact flashcard deck from one student's lecture notes.
Rules:
- Write 8 to 14 cards. Each card has a short prompt on the front and a clear answer on the back.
- Cover the main ideas, names, definitions and examples in the source.
- Keep the source language and register. If the source is Pidgin, write the cards in Pidgin. Never translate Pidgin into formal English.
- Use only facts found in the source. Never invent anything.
- Keep fronts under 120 characters and backs under 320 characters.
Return only a JSON object with this exact shape:
{"cards":[{"front":"...","back":"..."}]}`;

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function bullets(value, limit) {
  return Array.isArray(value) ? value.map((item) => text(item, limit)).filter(Boolean).slice(0, 40) : [];
}

export function studySourceText(capture) {
  const notes = capture?.notes && typeof capture.notes === "object" ? capture.notes : {};
  const pieces = [];

  const summary = text(notes.summary, 6_000);
  if (summary) pieces.push(`Summary:\n${summary}`);

  const highlights = bullets(notes.highlights, 600);
  if (highlights.length) pieces.push(`Key points:\n${highlights.map((item) => `- ${item}`).join("\n")}`);

  const sections = Array.isArray(notes.sections) ? notes.sections : [];
  for (const section of sections) {
    const heading = text(section?.heading, 200);
    if (!heading) continue;
    const lines = bullets(section?.bullets, 800);
    pieces.push(`${heading}:\n${lines.length ? lines.map((item) => `- ${item}`).join("\n") : "(no detail)"}`);
  }

  let source = pieces.join("\n\n");
  if (source.length < 3_000) {
    const transcript = Array.isArray(capture?.transcript) ? capture.transcript : [];
    const lines = transcript.flatMap((line) => {
      const body = text(line?.text, 1_200);
      if (!body) return [];
      const speaker = text(line?.speaker, 80);
      return [`${speaker ? `${speaker}: ` : ""}${body}`];
    });
    if (lines.length) {
      source = `${source}${source ? "\n\n" : ""}Transcript:\n${lines.join("\n").slice(0, MAX_TRANSCRIPT_CHARS)}`;
    }
  }

  return source.slice(0, MAX_SOURCE_CHARS).trim();
}

export function normalizeQuestions(value) {
  const list = Array.isArray(value?.questions) ? value.questions : [];
  const questions = list.flatMap((item) => {
    const question = text(item?.question, 500);
    const options = Array.isArray(item?.options) ? item.options.map((option) => text(option, 300)) : [];
    if (!question || options.length !== 4 || options.some((option) => !option)) return [];
    if (new Set(options.map((option) => option.toLowerCase())).size !== 4) return [];
    const answer = Number(item?.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return [];
    return [{ question, options, answer, explanation: text(item?.explanation, 500) }];
  });
  return questions.slice(0, 10);
}

export function normalizeCards(value) {
  const list = Array.isArray(value?.cards) ? value.cards : [];
  const cards = list.flatMap((item) => {
    const front = text(item?.front, 200);
    const back = text(item?.back, 500);
    return front && back ? [{ front, back }] : [];
  });
  return cards.slice(0, 16);
}

function sourceLines(capture) {
  return studySourceText(capture)
    .split(/\n+/)
    .map((line) => line.replace(/^[-#*\s]+/, "").trim())
    .filter((line) => line.length > 24 && !line.endsWith(":"));
}

function demoQuiz(capture) {
  const lines = sourceLines(capture).slice(0, 6);
  const questions = (lines.length ? lines : ["The session did not leave enough detail for a quiz."]).map(
    (line, index) => ({
      question: `What is the key point ${index + 1} from this session?`,
      options: [line.slice(0, 120), "A detail from a different session", "The opposite of what was said", "None of these"],
      answer: 0,
      explanation: "This comes straight from the session notes.",
    }),
  );
  return { questions };
}

function demoCards(capture) {
  const lines = sourceLines(capture).slice(0, 10);
  const cards = (lines.length ? lines : ["The session did not leave enough detail for cards."]).map((line, index) => ({
    front: `Key point ${index + 1}`,
    back: line.slice(0, 300),
  }));
  return { cards };
}

export async function generateStudySet({ capture, kind }) {
  if (mockEnabled()) {
    return { payload: kind === "quiz" ? demoQuiz(capture) : demoCards(capture), provider: "demo" };
  }

  const source = studySourceText(capture);
  if (!source) {
    throw new HttpError(400, "This note has no words to build a study set from yet.");
  }

  const { value, provider } = await chatJson({
    messages: [
      { role: "system", content: kind === "quiz" ? QUIZ_SYSTEM : CARDS_SYSTEM },
      { role: "user", content: `Source:\n${source}` },
    ],
    maxTokens: kind === "quiz" ? 2_200 : 1_600,
    temperature: 0.25,
  });

  if (kind === "quiz") {
    const questions = normalizeQuestions(value);
    if (questions.length < 3) throw new HttpError(502, "The quiz came back thin. Try again.");
    return { payload: { questions }, provider };
  }

  const cards = normalizeCards(value);
  if (cards.length < 3) throw new HttpError(502, "The cards came back thin. Try again.");
  return { payload: { cards }, provider };
}
