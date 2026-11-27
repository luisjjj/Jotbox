import { CircleHelp, Layers, ListChecks, Mail, Wand2 } from "lucide-react";
import type { Session } from "@/lib/types";

interface Recipe {
  key: string;
  label: string;
  hint: string;
  Icon: typeof Mail;
  onClick: () => void;
  disabled?: boolean;
}

export function SessionRecipes({
  session,
  isStudent,
  onFollowUp,
  onCopyActions,
  onExplain,
  onStudy,
}: {
  session: Session;
  isStudent: boolean;
  onFollowUp: () => void;
  onCopyActions: () => void;
  onExplain: () => void;
  onStudy: (format: "quiz" | "cards") => void;
}) {
  const actions = session.notes?.actions ?? [];
  const open = actions.filter((action) => !action.done).length;
  const recipes: Recipe[] = [
    {
      key: "recap",
      label: "Follow-up email",
      hint: "Edit and send it",
      Icon: Mail,
      onClick: onFollowUp,
    },
    {
      key: "actions",
      label: "Copy actions",
      hint: actions.length ? `${open} open` : "No actions yet",
      Icon: ListChecks,
      onClick: onCopyActions,
      disabled: actions.length === 0,
    },
    {
      key: "explain",
      label: "Explain simply",
      hint: "Plain words",
      Icon: Wand2,
      onClick: onExplain,
    },
    ...(isStudent
      ? [
          {
            key: "cards",
            label: "Flashcards",
            hint: "Make a deck",
            Icon: Layers,
            onClick: () => onStudy("cards"),
          },
          {
            key: "quiz",
            label: "Quiz",
            hint: "Test yourself",
            Icon: CircleHelp,
            onClick: () => onStudy("quiz"),
          },
        ]
      : []),
  ];

  return (
    <section className="mt-5" aria-label="Make something from this session">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">Make something</h2>
        <span className="hidden text-[12px] text-faint sm:inline">From the words and notes</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {recipes.map(({ key, label, hint, Icon, onClick, disabled }) => (
          <button
            key={key}
            type="button"
            className="card flex w-full items-start gap-3 p-3 text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClick}
            disabled={disabled}
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium leading-5 text-ink">{label}</span>
              <span className="mt-0.5 block text-[12px] leading-4 text-faint">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
