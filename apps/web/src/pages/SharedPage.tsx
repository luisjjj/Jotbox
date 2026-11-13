import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Check, FileText, Loader2, Lock } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Brand } from "@/components/Brand";
import { KindBadge } from "@/components/KindBadge";
import { api, ApiError, type PublicShare } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { OUTPUT_PRESETS } from "@/lib/presets";

export default function SharedPage() {
  const { token = "" } = useParams();
  const [capture, setCapture] = useState<PublicShare | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getPublicShare(token)
      .then((result) => {
        if (alive) setCapture(result.capture);
      })
      .catch((caught) => {
        if (alive) {
          setError(caught instanceof ApiError ? caught.message : "This link could not be opened.");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (capture) document.title = `${capture.title} · JotBox`;
  }, [capture]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4">
        <div className="flex items-center gap-2 text-[14px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening the notes
        </div>
      </div>
    );
  }

  if (!capture) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4">
        <div className="w-full max-w-[440px] rounded-2xl border border-line bg-raised p-6 text-center shadow-sm">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-raised-2 text-faint">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-[19px] font-semibold tracking-[-0.02em] text-ink">
            This link is not open
          </h1>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            {error || "It may have expired, or the person who shared it turned it off."}
          </p>
          <Link to="/" className="btn btn-line mt-4">
            <ArrowLeft className="h-4 w-4" />
            Go to JotBox
          </Link>
        </div>
      </div>
    );
  }

  const notes = capture.notes;
  const preset = OUTPUT_PRESETS[capture.kind];

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex max-w-[820px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Brand />
          <span className="inline-flex items-center gap-1.5 text-[12px] text-faint">
            <Lock className="h-3 w-3" />
            Read-only link
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-4 py-7 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={capture.kind} />
          <span className="text-[13.5px] text-muted">{format(capture.createdAt, "EEEE, d MMMM yyyy · HH:mm")}</span>
          {capture.durationSec > 0 && (
            <>
              <span className="text-faint">·</span>
              <span className="text-[13.5px] tabular-nums text-muted">{formatClock(capture.durationSec)}</span>
            </>
          )}
        </div>
        <h1 className="mt-2.5 text-[28px] font-semibold leading-tight tracking-[-0.04em] text-ink sm:text-[36px]">
          {capture.title}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-faint">
          Shared by {capture.ownerName || "the person who recorded it"}
          {capture.expiresAt ? ` · link ends ${format(capture.expiresAt, "d MMM yyyy")}` : ""}
        </p>

        {capture.participants.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {capture.participants.map((person) => (
              <span key={person.id} className="chip">
                {person.name}
                {person.external ? " · guest" : ""}
              </span>
            ))}
          </div>
        )}

        {notes && (notes.summary.trim() || notes.highlights.length || notes.decisions?.length) ? (
          <article className="mt-8">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
              {preset.summaryLabel}
            </h2>
            <p className="mt-2.5 max-w-[70ch] text-[20px] leading-[1.6] text-soft sm:text-[22px]">
              {notes.summary}
            </p>

            {notes.highlights.length > 0 && (
              <section className="mt-8">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                  {preset.highlightsLabel}
                </h2>
                <ul className="mt-3 space-y-2.5">
                  {notes.highlights.map((highlight) => (
                    <li key={highlight} className="flex gap-3">
                      <span className="bullet-dot" />
                      <p className="text-[16px] leading-6 text-soft">{highlight}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {notes.decisions && notes.decisions.length > 0 && (
              <section className="mt-8">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                  {preset.decisionsLabel}
                </h2>
                <ul className="mt-3 space-y-2.5">
                  {notes.decisions.map((decision) => (
                    <li key={decision} className="flex gap-3">
                      <Check className="mt-1 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.5} />
                      <p className="text-[16px] leading-6 text-soft">{decision}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {notes.actions.length > 0 && (
              <section className="mt-8">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                  {preset.actionsLabel}
                </h2>
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
                  {notes.actions.map((action) => (
                    <li key={action.id} className="flex items-start gap-3 px-3.5 py-3">
                      <span
                        className="mt-1 grid h-4 w-4 flex-none place-items-center rounded-[5px] border border-line-strong text-accent"
                        aria-hidden="true"
                      >
                        {action.done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={action.done ? "text-[15.5px] leading-5 text-faint line-through" : "text-[15.5px] leading-5 text-soft"}>
                          {action.text}
                        </p>
                        <p className="mt-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                          {action.owner}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {notes.sections.map((section) => (
              <section key={section.heading} className="mt-8">
                <h2 className="text-[17.5px] font-semibold tracking-[-0.02em] text-ink">{section.heading}</h2>
                <ul className="mt-2.5 space-y-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="bullet-dot" />
                      <p className="text-[16px] leading-6 text-soft">{bullet}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        ) : (
          <div className="mt-8 rounded-xl border border-line bg-raised px-4 py-5 text-[14.5px] leading-6 text-muted">
            <FileText className="mb-2 h-4 w-4 text-faint" />
            The notes were not finished for this session. The spoken words are below.
          </div>
        )}

        {capture.transcript.length > 0 && (
          <section className="mt-10 border-t border-line pt-6">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">Spoken words</h2>
            <div className="mt-3 space-y-3">
              {capture.transcript.map((line) => (
                <div key={line.id} className="flex gap-3">
                  <span className="w-10 flex-none pt-0.5 text-right text-[11.5px] tabular-nums text-faint">
                    {formatClock(line.at)}
                  </span>
                  <p className="min-w-0 flex-1 text-[15px] leading-6 text-soft">
                    {line.speaker && <strong className="font-semibold text-ink">{line.speaker}: </strong>}
                    {line.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-10 border-t border-line pt-4 text-[12.5px] leading-5 text-faint">
          Shared as a read-only page. The audio and private jottings stay on the recorder's device. Notes are a
          summary, so check names, numbers, and owners before you act on them.
        </footer>
      </main>
    </div>
  );
}
