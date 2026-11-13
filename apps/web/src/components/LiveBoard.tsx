import { CheckCircle2, ListChecks, Plus } from "lucide-react";
import type { LiveInsights } from "@/lib/types";

export function LiveBoard({
  insights,
  onKeep,
}: {
  insights: LiveInsights;
  onKeep: (text: string, owner?: string) => void;
}) {
  const total = insights.decisions.length + insights.actions.length;

  return (
    <section className="card mt-3 overflow-hidden" aria-label="Live decisions and actions">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-accent" />
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">Live board</h2>
        </div>
        <span className="text-[12px] text-faint">
          {total === 0 ? "Listening for decisions" : `${total} spotted`}
        </span>
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-raised px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
            <CheckCircle2 className="h-3 w-3" />
            Decisions
          </p>
          {insights.decisions.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] leading-5 text-faint">None yet.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {insights.decisions.map((decision) => (
                <li key={decision} className="group flex items-start gap-1.5">
                  <p className="min-w-0 flex-1 text-[13.5px] leading-5 text-soft">{decision}</p>
                  <button
                    type="button"
                    className="icon-btn h-6 w-6 flex-none text-faint opacity-70 hover:text-accent sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={() => onKeep(decision)}
                    title="Add to your jottings"
                    aria-label={`Add decision to jottings: ${decision}`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-raised px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
            <ListChecks className="h-3 w-3" />
            Actions
          </p>
          {insights.actions.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] leading-5 text-faint">None yet.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {insights.actions.map((action) => (
                <li key={action.text} className="group flex items-start gap-1.5">
                  <p className="min-w-0 flex-1 text-[13.5px] leading-5 text-soft">
                    {action.text}
                    {action.owner && action.owner !== "Unassigned" && (
                      <span className="ml-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                        {action.owner}
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    className="icon-btn h-6 w-6 flex-none text-faint opacity-70 hover:text-accent sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={() => onKeep(action.text, action.owner)}
                    title="Add to your jottings"
                    aria-label={`Add action to jottings: ${action.text}`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
