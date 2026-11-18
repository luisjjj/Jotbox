import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  Loader2,
  Lock,
  Mail,
  Sparkles,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api, ApiError, type EnterpriseInvite } from "@/lib/api";
import { Brand } from "@/components/Brand";

const WINDOWS_DOWNLOAD = "/api/download/windows";
const CONTACT_EMAIL = "hello@jotbox.com";

type Step = {
  id: string;
  title: string;
  body: string;
  host: string;
  action?: { label: string; to: string };
};

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Meet the workspace",
    body: "Confirm who is in the first group, how many seats they need, and what a good first month looks like. JotBox listens, keeps the Pidgin and the tone, and writes the notes.",
    host: "Confirm the seat count and the $25 per seat price. Agree that the pilot starts with one team and one recurring meeting.",
  },
  {
    id: "account",
    title: "Sign in or create the owner account",
    body: "The person who owns the workspace signs in with the email this invite was sent to. This seat can invite everyone else and change retention later.",
    host: "Ask them to create the account with the email on this invite. If they already have a personal JotBox account, sign in with it instead.",
  },
  {
    id: "workspace",
    title: "Name the workspace",
    body: "Open settings and give the organisation its real name. Set how long notes are kept, because the retention rule applies to every meeting the team shares.",
    host: "Open Settings together. Set retention to their policy, not the default, and explain that private meetings stay private.",
    action: { label: "Open workspace settings", to: "/settings" },
  },
  {
    id: "team",
    title: "Invite the team",
    body: "Add the department leads first. Roles decide who can see department notes, who can share a meeting, and who can change the workspace.",
    host: "Invite one or two department leads. Keep admin to two people at the start and add the rest as members.",
    action: { label: "Invite people", to: "/settings" },
  },
  {
    id: "first_meeting",
    title: "Record the first real meeting",
    body: "Use the microphone in the room or share a call tab. JotBox keeps the audio on the device and writes the notes, decisions, and actions when you stop.",
    host: "Record something real today, not a demo. Show the notes, the action items, the branded PDF, and one share link.",
    action: { label: "Start a capture", to: "/listen" },
  },
  {
    id: "rollout",
    title: "Agree the rollout",
    body: "Choose the first team, a weekly meeting to follow, and a date to review the notes together. Your JotBox contact stays on the account through the rollout.",
    host: "Agree a 30-day check-in, name the workspace owner, and confirm who to call when a seat needs changing.",
  },
];

function formatDate(value: number) {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function EnterpriseOnboarding() {
  const { token = "" } = useParams();
  const [invite, setInvite] = useState<EnterpriseInvite | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [hostView, setHostView] = useState(false);
  const [savingStep, setSavingStep] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [acceptedLocally, setAcceptedLocally] = useState(false);

  useEffect(() => {
    const previous = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
    document.title = "Enterprise onboarding · JotBox";
    return () => {
      if (previous === null) meta?.remove();
      else meta?.setAttribute("content", previous);
    };
  }, []);

  useEffect(() => {
    let live = true;
    setStatus("loading");
    api
      .getOnboarding(token)
      .then(({ invite: value }) => {
        if (!live) return;
        setInvite(value);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!live) return;
        setError(caught instanceof ApiError ? caught.message : "Could not open this onboarding link.");
        setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [token]);

  const checklist = invite?.checklist ?? {};
  const doneCount = useMemo(() => STEPS.filter((step) => checklist[step.id]).length, [checklist]);
  const accepted = Boolean(invite?.accepted || acceptedLocally);
  const signedIn = Boolean(invite?.signedInEmail);
  const selfHref = `/enterprise/onboarding/${token}`;
  const authHref = `/auth?next=${encodeURIComponent(selfHref)}`;

  const toggleStep = async (step: Step, done: boolean) => {
    if (!invite || savingStep) return;
    setSavingStep(step.id);
    setInvite({ ...invite, checklist: { ...checklist, [step.id]: done } });
    try {
      const result = await api.checkOnboardingStep(token, step.id, done);
      setInvite((current) => (current ? { ...current, checklist: result.checklist } : current));
    } catch (caught) {
      setInvite((current) =>
        current ? { ...current, checklist: { ...current.checklist, [step.id]: !done } } : current,
      );
      toast.error(caught instanceof ApiError ? caught.message : "Could not save that step.");
    } finally {
      setSavingStep(null);
    }
  };

  const finish = async () => {
    if (!invite || finishing) return;
    setFinishing(true);
    try {
      const result = await api.acceptOnboarding(token);
      setInvite({ ...invite, accepted: true, acceptedAt: result.acceptedAt });
      setAcceptedLocally(true);
      toast.success("Onboarding marked complete");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not finish onboarding.");
    } finally {
      setFinishing(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
          <p className="text-[13px] text-faint">Opening your private onboarding</p>
        </div>
      </div>
    );
  }

  if (status === "error" || !invite) {
    return (
      <div className="min-h-dvh bg-paper">
        <header className="border-b border-line bg-raised">
          <div className="mx-auto flex h-16 max-w-[1120px] items-center px-4 sm:px-6 lg:px-8">
            <Brand />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[520px] px-4 py-12">
          <div className="card p-6 sm:p-7">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <Lock className="h-5 w-5" />
            </span>
            <h1 className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-ink">
              This link cannot be opened
            </h1>
            <p className="mt-2.5 text-[14.5px] leading-6 text-muted">{error}</p>
            <a href={`mailto:${CONTACT_EMAIL}?subject=JotBox%20enterprise%20onboarding`} className="btn btn-primary mt-6 w-full">
              <Mail className="h-4 w-4" />
              Ask for a new link
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          <span className="chip !min-h-0 !px-2.5 !py-1 !text-[11.5px]">
            <Lock className="h-3 w-3" />
            Private onboarding
          </span>
        </div>
      </header>

      <main className="page-enter mx-auto w-full max-w-[920px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
          <div className="min-w-0">
            <p className="kicker">Enterprise onboarding</p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.045em] text-ink sm:text-[42px]">
              Welcome, {invite.company}.
            </h1>
            <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-muted">
              This is the walkthrough we go through together. Six short steps, then the workspace is yours. The link is
              private, but the workspace still asks everyone to sign in.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="chip">
                <Users className="h-3 w-3" />
                {invite.seats} seat{invite.seats === 1 ? "" : "s"}
              </span>
              <span className="chip">
                <Building2 className="h-3 w-3" />${invite.priceUsd} per seat / month
              </span>
              <span className="chip">
                <Circle className="h-2.5 w-2.5" />
                {doneCount} of {STEPS.length} done
              </span>
            </div>

            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-raised-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.round((doneCount / STEPS.length) * 100)}%` }}
              />
            </div>

            <div className="mt-6 rounded-xl border border-line bg-raised px-4 py-3.5">
              {signedIn ? (
                <p className="flex items-start gap-2 text-[13.5px] leading-5 text-soft">
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.4} />
                  <span>
                    Signed in as <span className="font-semibold text-ink">{invite.signedInEmail}</span>. The steps below
                    open the real workspace.
                  </span>
                </p>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13.5px] leading-5 text-soft">
                    {invite.contactName ? `${invite.contactName}, sign in` : "Sign in"} with the email this invite was
                    sent to, then come back to this page to finish the steps.
                  </p>
                  <Link to={authHref} className="btn btn-primary btn-sm flex-none justify-center">
                    Continue to sign in
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">The walkthrough</h2>
              <button
                type="button"
                onClick={() => setHostView((value) => !value)}
                className="btn btn-ghost btn-sm"
                aria-pressed={hostView}
              >
                {hostView ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Host notes
              </button>
            </div>

            <ol className="mt-3 space-y-3">
              {STEPS.map((step, index) => {
                const done = Boolean(checklist[step.id]);
                const saving = savingStep === step.id;
                return (
                  <li key={step.id} className="card p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-semibold ${
                          done ? "bg-accent text-accent-ink" : "bg-raised-2 text-faint"
                        }`}
                      >
                        {done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                          <h3 className="text-[15.5px] font-semibold tracking-[-0.015em] text-ink">{step.title}</h3>
                          <label className="inline-flex flex-none cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-muted">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-line-strong text-accent accent-[var(--accent)]"
                              checked={done}
                              disabled={saving}
                              onChange={(event) => void toggleStep(step, event.target.checked)}
                            />
                            {saving ? "Saving…" : done ? "Done" : "Mark done"}
                          </label>
                        </div>
                        <p className="mt-1.5 text-[14px] leading-6 text-muted">{step.body}</p>
                        {step.action && (
                          <Link to={step.action.to} className="btn btn-line btn-sm mt-3">
                            {step.action.label}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        {hostView && (
                          <div className="mt-3 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
                              <Sparkles className="h-3 w-3" />
                              Host talk track
                            </p>
                            <p className="mt-1 text-[13px] leading-5 text-soft">{step.host}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="card mt-5 p-5 sm:p-6">
              {accepted ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-ink">
                      <Check className="h-4 w-4" strokeWidth={2.6} />
                    </span>
                    <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Onboarding complete</h2>
                  </div>
                  <p className="mt-2 text-[14px] leading-6 text-muted">
                    The workspace is ready. Everyone still signs in before their notes open, on the web and in the
                    Windows app.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Link to={signedIn ? "/app" : authHref} className="btn btn-primary">
                      {signedIn ? "Open JotBox" : "Sign in to open it"}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <a href={WINDOWS_DOWNLOAD} className="btn btn-line">
                      <Download className="h-4 w-4" />
                      Download for Windows
                    </a>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Finished the walkthrough?</h2>
                    <p className="mt-1 text-[13.5px] leading-5 text-muted">
                      Mark it complete so your JotBox contact knows the rollout has started.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary flex-none"
                    onClick={() => void finish()}
                    disabled={finishing}
                  >
                    {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {finishing ? "Saving…" : "Mark onboarding complete"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-6">
            <div className="card p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Your plan</p>
              <p className="mt-2 text-[15px] font-semibold text-ink">{invite.company}</p>
              <dl className="mt-3 space-y-2 text-[13px] leading-5">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Seats</dt>
                  <dd className="font-medium text-ink">{invite.seats}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Price</dt>
                  <dd className="font-medium text-ink">${invite.priceUsd} / seat / month</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Link expires</dt>
                  <dd className="font-medium text-ink">{formatDate(invite.expiresAt)}</dd>
                </div>
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-[12px] leading-5 text-faint">
                Prepared for {invite.contactName ? `${invite.contactName}, ` : ""}
                {invite.contactEmail}.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-highlight p-4">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-brass">
                <Lock className="h-3 w-3" />
                Keep this link private
              </p>
              <p className="mt-1.5 text-[12.5px] leading-5 text-soft">
                Anyone with this link can open this page. Do not post it or forward it outside your team. If it leaks,
                email us and we will turn it off.
              </p>
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=JotBox%20enterprise%20onboarding`}
                className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                {CONTACT_EMAIL}
              </a>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
