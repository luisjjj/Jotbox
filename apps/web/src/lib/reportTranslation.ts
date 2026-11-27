import type { ReportLanguage, TranslatedReport } from "./api";
import type { SessionNotes } from "./types";

export interface ReportLanguageOption {
  value: ReportLanguage;
  label: string;
  hint: string;
}

export const REPORT_LANGUAGES: ReportLanguageOption[] = [
  { value: "pcm", label: "Pidgin", hint: "The whole report in everyday Nigerian Pidgin" },
  { value: "yo", label: "Yoruba", hint: "Standard Yoruba with tone marks and subdots" },
  { value: "ig", label: "Igbo", hint: "Standard Igbo with subdots and tone marks" },
  { value: "ha", label: "Hausa", hint: "Standard Hausa with hooked letters" },
];

export function reportLanguageLabel(language: ReportLanguage | null | undefined): string {
  return REPORT_LANGUAGES.find((option) => option.value === language)?.label ?? "";
}

export function reportTranslationInput(notes: SessionNotes): TranslatedReport {
  return {
    title: "",
    summary: notes.summary,
    highlights: notes.highlights,
    decisions: notes.decisions ?? [],
    blockers: notes.blockers ?? [],
    actions: notes.actions.map((action) => ({ text: action.text, owner: action.owner, due: action.due ?? "" })),
    followUps: (notes.followUps ?? []).map((draft) => ({ to: draft.to, subject: draft.subject, body: draft.body })),
    sections: notes.sections.map((section) => ({ heading: section.heading, bullets: section.bullets })),
  };
}

// Names, owners, deadlines and quotes stay in the source report. A translated
// line that came back empty falls back to the source at the same index, so a
// short model answer never hides content.
export function mergeTranslatedReport(
  source: SessionNotes,
  translated: TranslatedReport | null,
): SessionNotes {
  if (!translated) return source;
  const lines = (original: string[], next: string[] | undefined) =>
    original.map((item, index) => (next?.[index]?.trim() ? next[index].trim() : item));

  return {
    ...source,
    summary: translated.summary.trim() || source.summary,
    highlights: lines(source.highlights, translated.highlights),
    decisions: source.decisions ? lines(source.decisions, translated.decisions) : source.decisions,
    blockers: source.blockers ? lines(source.blockers, translated.blockers) : source.blockers,
    actions: source.actions.map((action, index) => ({
      ...action,
      text: translated.actions?.[index]?.text?.trim() || action.text,
    })),
    followUps: source.followUps?.map((draft, index) => {
      const next = translated.followUps?.[index];
      return {
        ...draft,
        subject: next?.subject?.trim() || draft.subject,
        body: next?.body?.trim() || draft.body,
      };
    }),
    sections: source.sections.map((section, index) => {
      const next = translated.sections?.[index];
      return {
        ...section,
        heading: next?.heading?.trim() || section.heading,
        bullets: lines(section.bullets, next?.bullets),
      };
    }),
  };
}
