import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  GraduationCap,
  Lightbulb,
  Loader2,
  Mic,
  Plus,
  Presentation,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Brand } from "@/components/Brand";
import { useSessions } from "@/lib/store";
import { DASHBOARD_ROLES, ROLE_META, type DashboardRole } from "@/lib/roles";
import {
  LANGUAGE_OPTIONS,
  getSessionLanguage,
  setFocusMode,
  setPickupMode,
  setSessionLanguage,
  type SessionLanguage,
} from "@/lib/listening";
import {
  HABIT_OPTIONS,
  LENGTH_OPTIONS,
  SAMPLE_DEMOS,
  freeSessionsEstimate,
  getHabit,
  getRegion,
  getSessionLength,
  languageOptionsForRegion,
  normalizeLanguage,
  savePeople,
  savedPeopleNames,
  setHabit,
  setPreferredKind,
  setRegion,
  setSessionLength,
  type Region,
  type SessionLength,
} from "@/lib/onboarding";
import { ensureUsage, isPaidPlan, planName, useUsage } from "@/lib/usageStore";
import type { PurchasePlan } from "@/lib/api";
import type { SessionKind } from "@/lib/types";

const STEP_COUNT = 6;
const FREE_MINUTES = 100;

const ROLE_ICONS: Record<DashboardRole, typeof GraduationCap> = {
  student: GraduationCap,
  seminar: Presentation,
  hobbyist: Lightbulb,
  team: BriefcaseBusiness,
};

const TIERS: { key: PurchasePlan; name: string; hours: string; points: string[] }[] = [
  {
    key: "starter",
    name: "Starter Pro",
    hours: "10 hours a month",
    points: ["Speaker names on every capture", "Names and room words boosted", "Study sets and downloads"],
  },
  {
    key: "power",
    name: "Power User",
    hours: "25 hours a month",
    points: ["Everything in Starter", "Room for long lectures and all-day meetings", "Best value per hour"],
  },
];

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/welcome")) return "/app";
  return value;
}

function planIntentFrom(next: string): PurchasePlan | null {
  const query = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
  const intent = new URLSearchParams(query).get("plan");
  return intent === "starter" || intent === "power" ? intent : null;
}

function naira(value: number) {
  return `₦${value.toLocaleString("en-NG")}`;
}

function ChoiceCard({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        "flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
        active ? "border-accent bg-accent-soft" : "border-line bg-raised hover:border-line-strong hover:bg-raised-2",
      )}
    >
      <span
        className={clsx(
          "grid h-10 w-10 flex-none place-items-center rounded-xl",
          active ? "bg-accent text-accent-ink" : "bg-raised-2 text-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-ink">{title}</span>
          {active && <Check className="h-4 w-4 flex-none text-accent" />}
        </span>
        <span className="mt-1 block text-[13px] leading-5 text-muted">{hint}</span>
      </span>
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-xl border border-rec-line bg-rec-soft px-3.5 py-2.5 text-[13.5px] text-soft">{message}</p>
  );
}

export default function Welcome() {
  const { user, updateRole } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const intent = planIntentFrom(next);

  const plan = useUsage((state) => state.plan);
  const usageLoaded = useUsage((state) => state.loaded);
  const configured = useUsage((state) => state.configured);
  const pricing = useUsage((state) => state.pricing);
  const paid = isPaidPlan(plan);

  const [step, setStep] = useState(0);
  const [region, setRegionChoice] = useState<Region | null>(() => getRegion());
  const [role, setRole] = useState<DashboardRole | null>(user?.role ?? null);
  const [habit, setHabitChoice] = useState<SessionKind>(() => getHabit() ?? "meeting");
  const [length, setLengthChoice] = useState<SessionLength>(() => getSessionLength() ?? "medium");
  const [language, setLanguageChoice] = useState<SessionLanguage>(() =>
    normalizeLanguage(getSessionLanguage(), getRegion()),
  );
  const [names, setNames] = useState<string[]>(() => savedPeopleNames());
  const [nameInput, setNameInput] = useState("");
  const [visible, setVisible] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureUsage();
  }, []);

  useEffect(() => {
    if (step !== 3) return;
    setVisible(0);
  }, [step, region]);

  const demo = SAMPLE_DEMOS[region ?? "nigeria"];
  const languages = languageOptionsForRegion(region);

  useEffect(() => {
    if (step !== 3) return;
    if (visible >= demo.lines.length) return;
    const timer = window.setTimeout(() => setVisible((count) => count + 1), visible === 0 ? 400 : 1000);
    return () => window.clearTimeout(timer);
  }, [visible, step, demo.lines.length]);

  const chooseRegion = (value: Region) => {
    setRegionChoice(value);
    setLanguageChoice((current) => normalizeLanguage(current, value));
    setError(null);
  };

  const addName = () => {
    const name = nameInput.trim();
    if (!name) return;
    if (names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setNameInput("");
      return;
    }
    setNames((current) => [...current, name].slice(0, 20));
    setNameInput("");
  };

  const persist = () => {
    if (region) setRegion(region);
    setHabit(habit);
    setSessionLength(length);
    setSessionLanguage(language);
    setFocusMode("balanced");
    setPickupMode(habit === "lecture" ? "far" : "balanced");
    setPreferredKind(habit);
    useSessions.getState().setLastKind(habit);
    savePeople(names);
  };

  const finish = async (target: string) => {
    if (!role) return;
    setSaving(true);
    setError(null);
    try {
      persist();
      await updateRole(role);
      navigate(target, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!user?.role) await updateRole("team");
      navigate(next, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  };

  const starterPrice = pricing?.starter ?? { usd: 7, naira: 9800 };
  const powerPrice = pricing?.power ?? { usd: 16, naira: 22400 };
  const priceFor = (tier: PurchasePlan) => (tier === "starter" ? starterPrice : powerPrice);

  const languageLabel = LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? "English";
  const roleLabel = role ? ROLE_META[role].label : "Not chosen";
  const habitLabel = HABIT_OPTIONS.find((option) => option.value === habit)?.label ?? "Meetings";
  const lengthLabel = LENGTH_OPTIONS.find((option) => option.value === length)?.label ?? "30 to 60 minutes";
  const plansBlocked = usageLoaded && !configured;

  const stepTitle = [
    "Where do you mostly record?",
    "What will you use JotBox for?",
    "How do you usually record?",
    "See what the note looks like.",
    "Set the words up your way.",
    `You are set, ${user?.name?.split(" ")[0] || "friend"}.`,
  ][step];

  const stepBody = [
    "This decides how JotBox listens from the start. You can change it later in Settings.",
    "This only changes what Home puts first. You can switch whenever you like.",
    "We use this to set up your first capture and tell you what your free minutes cover.",
    "A short sample, recorded the way your rooms sound. Watch it become a note.",
    "Pick the language you record in and add the people whose names should always come out right.",
    paid
      ? "Your plan is active, so there is nothing to buy. Take a look at what we set up, then start recording."
      : "One last look at what we set up. Start free, or pick a plan now.",
  ][step];

  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col px-4 py-6 sm:px-6 sm:py-9">
        <header className="flex items-center justify-between gap-3">
          <Brand to="/app" />
          <div className="flex items-center gap-3">
            <span className="kicker hidden sm:inline">
              Step {step + 1} of {STEP_COUNT}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => void skip()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Skip
            </button>
          </div>
        </header>

        <div className="mt-5 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: STEP_COUNT }).map((_, index) => (
            <span
              key={index}
              className={clsx(
                "h-1 flex-1 rounded-full transition-colors",
                index <= step ? "bg-accent" : "bg-raised-2",
              )}
            />
          ))}
        </div>

        <main className="flex flex-1 items-start justify-center py-7 sm:items-center sm:py-10">
          <div className="w-full max-w-[820px]" key={step}>
            <div className="reveal-in">
              <p className="kicker text-accent">Welcome to JotBox</p>
              <h1 className="mt-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.04em] text-ink sm:text-[36px]">
                {stepTitle}
              </h1>
              <p className="mt-2.5 max-w-[60ch] text-[14.5px] leading-6 text-muted sm:text-[15.5px]">{stepBody}</p>

              {step === 0 && (
                <div role="radiogroup" aria-label="Where you mostly record" className="mt-6 grid gap-2.5 sm:grid-cols-2">
                  <ChoiceCard
                    active={region === "nigeria"}
                    onClick={() => chooseRegion("nigeria")}
                    icon={<Mic className="h-[19px] w-[19px]" strokeWidth={1.9} />}
                    title="Nigeria"
                    hint="Pidgin, Yoruba, Hausa, and Igbo stay exactly as the room said them."
                  />
                  <ChoiceCard
                    active={region === "international"}
                    onClick={() => chooseRegion("international")}
                    icon={<Sparkles className="h-[19px] w-[19px]" strokeWidth={1.9} />}
                    title="Somewhere else"
                    hint="English, with the names and room words you add spelled correctly."
                  />
                </div>
              )}

              {step === 1 && (
                <div role="radiogroup" aria-label="How you will use JotBox" className="mt-6 grid gap-2.5 sm:grid-cols-2">
                  {DASHBOARD_ROLES.map((value) => {
                    const Icon = ROLE_ICONS[value];
                    const active = role === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setRole(value);
                          setError(null);
                        }}
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
                            <span className="text-[15.5px] font-semibold text-ink">{ROLE_META[value].label}</span>
                            {active && <Check className="h-4 w-4 flex-none text-accent" />}
                          </span>
                          <span className="mt-0.5 block text-[12.5px] font-medium uppercase tracking-[0.06em] text-faint">
                            {ROLE_META[value].short}
                          </span>
                          <span className="mt-1.5 block text-[13.5px] leading-5 text-muted">
                            {ROLE_META[value].blurb}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step === 2 && (
                <div className="mt-6 space-y-5">
                  <div>
                    <p className="label">What fills your recordings?</p>
                    <div role="radiogroup" aria-label="Recording habit" className="mt-2 grid gap-2.5 sm:grid-cols-2">
                      {HABIT_OPTIONS.map((option) => (
                        <ChoiceCard
                          key={option.value}
                          active={habit === option.value}
                          onClick={() => setHabitChoice(option.value)}
                          icon={<Mic className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                          title={option.label}
                          hint={option.hint}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="label">How long is a normal one?</p>
                    <div role="radiogroup" aria-label="Session length" className="mt-2 grid gap-2.5 sm:grid-cols-3">
                      {LENGTH_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={length === option.value}
                          onClick={() => setLengthChoice(option.value)}
                          className={clsx(
                            "rounded-2xl border px-4 py-3 text-left transition-colors",
                            length === option.value
                              ? "border-accent bg-accent-soft"
                              : "border-line bg-raised hover:border-line-strong",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2 text-[14px] font-semibold text-ink">
                            {option.label}
                            {length === option.value && <Check className="h-4 w-4 flex-none text-accent" />}
                          </span>
                          <span className="mt-1 block text-[12.5px] leading-4 text-muted">{option.hint}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-[13px] leading-5 text-faint">
                      Free comes with {FREE_MINUTES} minutes, {freeSessionsEstimate(length)} at this length. Every paid
                      plan refills each month.
                    </p>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-raised p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-rec-soft text-rec">
                          <Mic className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-[14.5px] font-semibold text-ink">{demo.title}</p>
                          <p className="text-[12px] text-faint">{demo.kicker}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setVisible(0)}
                        disabled={visible === 0}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Replay
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {demo.lines.slice(0, visible).map((line, index) => (
                        <div key={`${line.speaker}-${index}`} className="reveal-in flex gap-2.5">
                          <span className="mt-0.5 w-[64px] flex-none truncate text-[12px] font-semibold uppercase tracking-[0.05em] text-faint">
                            {line.speaker}
                          </span>
                          <p className="text-[14px] leading-5 text-soft">{line.text}</p>
                        </div>
                      ))}
                      {visible < demo.lines.length && (
                        <div className="flex items-center gap-2 pt-1 text-[12.5px] text-faint">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rec opacity-60" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-rec" />
                          </span>
                          Listening. Words appear as people speak.
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className={clsx(
                      "rounded-2xl border p-4 transition-colors sm:p-5",
                      visible >= demo.lines.length
                        ? "border-accent/30 bg-accent-soft"
                        : "border-dashed border-line bg-raised/60",
                    )}
                  >
                    {visible >= demo.lines.length ? (
                      <div className="reveal-in">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-accent" />
                          <p className="text-[14.5px] font-semibold text-ink">The note, written for you</p>
                        </div>
                        <p className="mt-3 text-[13.5px] leading-6 text-soft">{demo.summary}</p>
                        <ul className="mt-4 space-y-2">
                          {demo.highlights.map((line) => (
                            <li key={line} className="flex items-start gap-2 text-[13px] leading-5 text-soft">
                              <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" />
                              {line}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-4 border-t border-accent/20 pt-3 text-[12px] leading-5 text-accent">
                          No typing. No clean-up. The words and the note stay side by side.
                        </p>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center">
                        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-raised-2 text-faint">
                          <Sparkles className="h-5 w-5" />
                        </span>
                        <p className="mt-3 max-w-[28ch] text-[13px] leading-5 text-faint">
                          Your note appears here when the recording ends.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="mt-6 grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="label">Language</p>
                    <div role="radiogroup" aria-label="Recording language" className="mt-2 space-y-2">
                      {languages.map((option) => (
                        <ChoiceCard
                          key={option.value}
                          active={language === option.value}
                          onClick={() => setLanguageChoice(option.value)}
                          icon={<span className="text-[12px] font-semibold uppercase">{option.value}</span>}
                          title={option.label}
                          hint={option.hint}
                        />
                      ))}
                    </div>
                    {region === "international" && (
                      <p className="mt-3 text-[12.5px] leading-5 text-faint">
                        JotBox keeps the language simple outside Nigeria. The people you add still get spelled right.
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="label">People in your rooms</p>
                    <p className="mt-1 text-[12.5px] leading-5 text-faint">
                      Add the names you say most. JotBox boosts them so notes spell them the way you do.
                    </p>
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        addName();
                      }}
                    >
                      <input
                        className="field"
                        value={nameInput}
                        onChange={(event) => setNameInput(event.target.value)}
                        placeholder="Ada, Chinedu, Maya"
                        maxLength={40}
                        aria-label="Add a person"
                      />
                      <button type="submit" className="btn btn-line px-3" disabled={!nameInput.trim()}>
                        <Plus className="h-4 w-4" />
                        Add
                      </button>
                    </form>
                    {names.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {names.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-[12.5px] font-medium text-soft"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() => setNames((current) => current.filter((item) => item !== name))}
                              className="grid h-4 w-4 place-items-center rounded-full text-faint hover:bg-raised-2 hover:text-ink"
                              aria-label={`Remove ${name}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-[12.5px] leading-5 text-faint">
                        No names yet. You can add them before any recording too.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-2xl border border-line bg-raised p-4 sm:p-5">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-faint">What we set up</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {[
                        { label: "Home", value: roleLabel, edit: 1 },
                        { label: "Records", value: habitLabel, edit: 2 },
                        { label: "Length", value: lengthLabel, edit: 2 },
                        { label: "Language", value: languageLabel, edit: 4 },
                        { label: "Names", value: names.length ? `${names.length} saved` : "None yet", edit: 4 },
                        { label: "Region", value: region === "nigeria" ? "Nigeria" : "International", edit: 0 },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between gap-2 rounded-xl bg-raised-2 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{row.label}</p>
                            <p className="truncate text-[13px] font-medium text-ink">{row.value}</p>
                          </div>
                          <button
                            type="button"
                            className="text-[12px] font-medium text-accent underline-offset-2 hover:underline"
                            onClick={() => setStep(row.edit)}
                          >
                            Edit
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {paid ? (
                    <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4 sm:p-5">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-accent" />
                        <p className="text-[14.5px] font-semibold text-ink">{planName(plan)} is active</p>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-5 text-muted">
                        Every recording is covered. No upgrade prompt, no extra step.
                      </p>
                    </div>
                  ) : intent ? (
                    <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4 sm:p-5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-accent" />
                        <p className="text-[14.5px] font-semibold text-ink">
                          {intent === "starter" ? "Starter Pro" : "Power User"} is ready for you
                        </p>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-5 text-muted">
                        {intent === "starter" ? "10 hours" : "25 hours"} a month, {naira(priceFor(intent).naira)} or $
                        {priceFor(intent).usd}. Finish the payment and onboarding ends without another prompt.
                      </p>
                    </div>
                  ) : (

                    <div className="grid gap-3 sm:grid-cols-2">
                      {TIERS.map((tier) => {
                        const price = priceFor(tier.key);
                        return (
                          <button
                            key={tier.key}
                            type="button"
                            disabled={saving || plansBlocked}
                            onClick={() => void finish(`/account?plan=${tier.key}`)}
                            className={clsx(
                              "rounded-2xl border p-4 text-left transition-colors",
                              tier.key === "power"
                                ? "border-accent bg-accent-soft hover:border-accent"
                                : "border-line bg-raised hover:border-line-strong",
                              (saving || plansBlocked) && "opacity-60",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[14.5px] font-semibold text-ink">{tier.name}</p>
                              {tier.key === "power" && (
                                <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-accent-ink">
                                  Best per hour
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink">
                              {region === "international" ? `$${price.usd}` : naira(price.naira)}
                              <span className="ml-1 text-[12.5px] font-medium text-muted">a month</span>
                            </p>
                            <p className="text-[12px] text-faint">{tier.hours}</p>
                            <ul className="mt-3 space-y-1.5">
                              {tier.points.map((point) => (
                                <li key={point} className="flex items-start gap-1.5 text-[12.5px] leading-5 text-soft">
                                  <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" />
                                  {point}
                                </li>
                              ))}
                            </ul>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!paid && plansBlocked && (
                    <p className="text-[12.5px] leading-5 text-faint">
                      Payments are not available right now. Start free and upgrade from Account later.
                    </p>
                  )}
                </div>
              )}

              {error && <ErrorNote message={error} />}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                {step > 0 && (
                  <button type="button" className="btn btn-line" disabled={saving} onClick={back}>
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}

                {step < 4 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving || (step === 0 && !region) || (step === 1 && !role)}
                    onClick={() => setStep((current) => current + 1)}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}

                {step === 4 && (
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => setStep(5)}>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}

                {step === 5 && paid && (
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void finish(next)}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Go to JotBox
                  </button>
                )}

                {step === 5 && !paid && intent && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving}
                      onClick={() => void finish(`/account?plan=${intent}`)}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Continue to payment
                    </button>
                    <button type="button" className="btn btn-line" disabled={saving} onClick={() => void finish("/app")}>
                      Start free instead
                    </button>
                  </>
                )}

                {step === 5 && !paid && !intent && (
                  <>
                    <button type="button" className="btn btn-line" disabled={saving} onClick={() => void finish(next)}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Start free with {FREE_MINUTES} minutes
                    </button>
                    <p className="text-[12px] leading-4 text-faint">No card. Upgrade only if you need more room.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
