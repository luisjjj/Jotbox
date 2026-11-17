import { useState } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Download,
  GraduationCap,
  Lightbulb,
  Loader2,
  Mic,
  NotebookPen,
  Presentation,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { Brand } from "@/components/Brand";
import { DASHBOARD_ROLES, ROLE_META, type DashboardRole } from "@/lib/roles";

const ROLE_ICONS: Record<DashboardRole, typeof GraduationCap> = {
  student: GraduationCap,
  seminar: Presentation,
  hobbyist: Lightbulb,
  team: BriefcaseBusiness,
};

const FOCUS_ICONS = [NotebookPen, Download, CalendarDays];

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/welcome")) return "/app";
  return value;
}

export default function Welcome() {
  const { user, updateRole } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [selected, setSelected] = useState<DashboardRole | null>(user?.role ?? null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (role: DashboardRole) => {
    setSelected(role);
    setError(null);
  };

  const finish = async (role: DashboardRole, skipped = false) => {
    setSaving(true);
    setError(null);
    try {
      await updateRole(role);
      toast.success(skipped ? "Showing the full workspace" : "Your dashboard is ready");
      navigate(next, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const meta = selected ? ROLE_META[selected] : null;

  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col px-4 py-6 sm:px-6 sm:py-9">
        <header className="flex items-center justify-between gap-3">
          <Brand to="/app" />
          <span className="kicker">Step {step + 1} of 2</span>
        </header>

        <main className="flex flex-1 items-center justify-center py-8 sm:py-12">
          <div className="w-full max-w-[780px]">
            {step === 0 ? (
              <div className="reveal-in">
                <p className="kicker text-accent">Welcome to JotBox</p>
                <h1 className="mt-2 text-[30px] font-semibold leading-[1.1] tracking-[-0.04em] text-ink sm:text-[38px]">
                  What will you use JotBox for?
                </h1>
                <p className="mt-3 max-w-[54ch] text-[15.5px] leading-6 text-muted">
                  This only changes what Home puts first. You can switch whenever you like in Settings.
                </p>

                <div role="radiogroup" aria-label="How you will use JotBox" className="mt-6 grid gap-2.5 sm:grid-cols-2">
                  {DASHBOARD_ROLES.map((role) => {
                    const Icon = ROLE_ICONS[role];
                    const active = selected === role;
                    return (
                      <button
                        key={role}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => choose(role)}
                        className={clsx(
                          "group flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
                          active
                            ? "border-accent bg-accent-soft"
                            : "border-line bg-raised hover:border-line-strong hover:bg-raised-2",
                        )}
                      >
                        <span
                          className={clsx(
                            "grid h-10 w-10 flex-none place-items-center rounded-xl",
                            active ? "bg-accent text-accent-ink" : "bg-raised-2 text-muted",
                          )}
                        >
                          <Icon className="h-[19px] w-[19px]" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[15.5px] font-semibold text-ink">{ROLE_META[role].label}</span>
                            {active && <Check className="h-4 w-4 flex-none text-accent" />}
                          </span>
                          <span className="mt-0.5 block text-[12.5px] font-medium uppercase tracking-[0.06em] text-faint">
                            {ROLE_META[role].short}
                          </span>
                          <span className="mt-1.5 block text-[13.5px] leading-5 text-muted">
                            {ROLE_META[role].blurb}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {error && (
                  <p className="mt-4 rounded-xl border border-rec-line bg-rec-soft px-3.5 py-2.5 text-[13.5px] text-soft">
                    {error}
                  </p>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!selected}
                    onClick={() => setStep(1)}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-line"
                    disabled={saving}
                    onClick={() => void finish("team", true)}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Skip, show me everything
                  </button>
                </div>
              </div>
            ) : (
              meta &&
              selected && (
                <div className="reveal-in">
                  <p className="kicker text-accent">{meta.label}</p>
                  <h1 className="mt-2 text-[30px] font-semibold leading-[1.1] tracking-[-0.04em] text-ink sm:text-[38px]">
                    {meta.homeTitle}
                  </h1>
                  <p className="mt-3 max-w-[56ch] text-[15.5px] leading-6 text-muted">{meta.homeBody}</p>

                  <div className="mt-6 rounded-2xl border border-line bg-raised p-4 sm:p-5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                        <Mic className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-[14.5px] font-semibold text-ink">Your Home</p>
                        <p className="text-[12.5px] text-faint">First things first</p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-2.5">
                      {meta.focus.map((line, index) => {
                        const Icon = FOCUS_ICONS[index] ?? Check;
                        return (
                          <li key={line} className="flex items-start gap-2.5 text-[14px] leading-5 text-soft">
                            <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-accent-soft text-accent">
                              <Icon className="h-3 w-3" />
                            </span>
                            {line}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {error && (
                    <p className="mt-4 rounded-xl border border-rec-line bg-rec-soft px-3.5 py-2.5 text-[13.5px] text-soft">
                      {error}
                    </p>
                  )}

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button type="button" className="btn btn-line" disabled={saving} onClick={() => setStep(0)}>
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving}
                      onClick={() => void finish(selected)}
                    >
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                      Start using JotBox
                      {!saving && <ArrowRight className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
