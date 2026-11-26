/**
 * Live captions are a preview and the browser speech fallback has no word
 * confidence, so profanity never appears there. The final transcript applies
 * the confidence rule on the server and can still keep a word that was
 * clearly said.
 */
const PROFANITY =
  /\b(?:assholes?|arseholes?|bastards?|bitches|bitchy|bitch|bullshit|(?:mother)?fuck(?:ed|er|ers|ing|s)?|cunts?|dickheads?|dicks?|horseshit|puss(?:y|ies)|shits?|shitty|sluts?|whores?)\b/gi;

export function stripLiveProfanity(text: string): string {
  return text
    .replace(PROFANITY, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^[\s,;:.!?]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
}