import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Loader2 } from "lucide-react";

const WRITING = [
  { verb: "Writing", line: "Turning the spoken words into a report." },
  { verb: "Drafting", line: "Sorting the decisions, actions and open questions." },
  { verb: "Cooking", line: "Letting the notes settle so the names come out right." },
  { verb: "Tidying names", line: "Checking the people, places and amounts." },
  { verb: "Checking facts", line: "Keeping every line tied to the recording." },
  { verb: "Almost there", line: "One last read before the report opens." },
];

export function ReportLoading({ hasWords }: { hasWords: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % WRITING.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  const phase = WRITING[index];
  const steps = [
    { label: "Read the recording", done: hasWords },
    { label: "Tidy names and terms", done: false },
    { label: "Write the report", done: false },
  ];

  return (
    <section className="card overflow-hidden p-5 sm:p-6" role="status">
      <p className="sr-only">Writing the report. This can take a minute.</p>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
        <div className="min-w-0">
          <p key={phase.verb} className="fade-up text-[17px] font-semibold text-ink">
            {phase.verb}
            <span className="text-faint">…</span>
          </p>
          <p key={phase.line} className="fade-up mt-1 text-[14.5px] leading-5 text-muted">
            {phase.line}
          </p>
        </div>
      </div>

      <div className="writing-track mt-5">
        <div className="writing-bar" />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-3" aria-hidden="true">
        {steps.map((step) => (
          <li
            key={step.label}
            className={clsx(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]",
              step.done ? "border-line bg-raised text-soft" : "border-line text-faint",
            )}
          >
            <span
              className={clsx(
                "grid h-4 w-4 flex-none place-items-center rounded-full border",
                step.done ? "border-accent bg-accent text-white" : "border-line-strong",
              )}
            >
              {step.done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
    </section>
  );
}