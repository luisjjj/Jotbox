import { useEffect, useRef, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Cloud,
  CreditCard,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IntegrationsCard } from "@/components/IntegrationsCard";
import { requestCloudSync } from "@/components/CloudSync";
import { api, type BillingPack, type BillingStatus, type CloudUser, type PurchasePlan } from "@/lib/api";
import { formatAllowance } from "@/lib/format";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { isPaidPlan, planName, useUsage } from "@/lib/usageStore";

function initialsFor(user: CloudUser) {
  const source = user.name.trim() || user.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "J").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function SyncChip() {
  const status = useSync((state) => state.status);
  const label =
    status === "ready"
      ? "Up to date"
      : status === "syncing"
        ? "Updating"
        : status === "error"
          ? "Couldn't update"
          : "Not yet";
  return (
    <span
      className={
        status === "ready"
          ? "chip border-transparent bg-accent-soft text-accent"
          : status === "error"
            ? "chip border-transparent bg-rec-soft text-rec"
            : "chip text-muted"
      }
    >
      {status === "syncing" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === "ready" ? (
        <Check className="h-3 w-3" />
      ) : status === "error" ? (
        <AlertCircle className="h-3 w-3" />
      ) : (
        <Cloud className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function planNote(status: BillingStatus["subscription"]): string {
  if (!status) return "";
  if (status.status === "active") {
    return status.nextPaymentAt
      ? `Renews on ${format(status.nextPaymentAt, "d MMM yyyy")}.`
      : "Renews every month.";
  }
  if (status.status === "attention") {
    return "The last payment did not go through. Paystack will retry, and we will let you know if it needs you.";
  }
  if (status.status === "non-renewing") {
    return status.nextPaymentAt
      ? `Ends on ${format(status.nextPaymentAt, "d MMM yyyy")}. It will not renew.`
      : "It will not renew.";
  }
  if (status.status === "cancelled") {
    return status.nextPaymentAt
      ? `Your plan stays on until ${format(status.nextPaymentAt, "d MMM yyyy")}. It will not renew.`
      : "This plan has ended.";
  }
  return "This plan has ended.";
}

function PlanCard() {
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [tab, setTab] = useState<"monthly" | "payg" | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref") || "";
    const returning = params.get("billing") === "callback" || Boolean(reference);
    const planParam = params.get("plan");
    const wantedTier: PurchasePlan | null =
      planParam === "starter" || planParam === "power" ? planParam : null;

    // Consume the plan intent before redirecting to Paystack. Pressing Back must
    // land on the account page, not start a second checkout.
    if (planParam) {
      const next = new URL(window.location.href);
      next.searchParams.delete("plan");
      window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
    }

    const load = async () => {
      try {
        if (returning && reference) {
          const result = await api.verifyCheckout(reference);
          setBilling(result);
          useUsage.getState().applyStatus(result);
          if (result.payment === "success" && result.minutes) {
            toast.success(`${result.minutes.toLocaleString("en-NG")} minutes added to your wallet.`);
          } else if (result.payment === "success" && isPaidPlan(result.plan)) {
            toast.success(`${planName(result.plan)} is active. Thank you.`);
          } else if (result.payment === "success" && result.mode === "payg") {
            toast.success("Your minutes are in your wallet.");
          } else {
            toast.error("That payment was not completed.");
          }
        } else {
          const result = await api.billingStatus();
          setBilling(result);
          useUsage.getState().applyStatus(result);
          if (returning) toast("No payment was made.");
          if (wantedTier && !returning && result.plan === "free" && result.configured) {
            setBusy(true);
            try {
              const session = await api.startCheckout(wantedTier);
              window.location.assign(session.authorizationUrl);
              return;
            } catch (checkoutError) {
              const message = errorText(checkoutError);
              setError(message);
              toast.error(message);
              navigate("/account", { replace: true });
              return;
            } finally {
              setBusy(false);
            }
          }
        }
        setError(null);
      } catch (loadError) {
        setError(errorText(loadError));
      } finally {
        setLoading(false);
        if (returning) navigate("/account", { replace: true });
      }
    };

    void load();
  }, [navigate]);

  const upgrade = async (tier: PurchasePlan) => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.startCheckout(tier);
      window.location.assign(session.authorizationUrl);
    } catch (upgradeError) {
      const message = errorText(upgradeError);
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const buyMinutes = async (pack: BillingPack) => {
    setBuying(pack.key);
    setError(null);
    try {
      const session = await api.startMinutesCheckout(pack.key);
      window.location.assign(session.authorizationUrl);
    } catch (buyError) {
      const message = errorText(buyError);
      setError(message);
      toast.error(message);
      setBuying(null);
    }
  };

  const stopRenewal = async () => {
    setConfirmCancel(false);
    setBusy(true);
    setError(null);
    try {
      setBilling(await api.cancelSubscription());
      toast.success(`Renewal stopped. You keep ${planName(plan)} until the period ends.`);
    } catch (cancelError) {
      const message = errorText(cancelError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const checkPayment = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.reconcileBilling();
      setBilling(result);
      useUsage.getState().applyStatus(result);
      toast.success(result.plan !== "free" ? `${planName(result.plan)} is active.` : "Checked with Paystack. Nothing new yet.");
    } catch (checkError) {
      const message = errorText(checkError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const plan = billing?.plan ?? "free";
  const paid = isPaidPlan(plan);
  const enterprise = plan === "enterprise";
  const payg = billing?.mode === "payg";
  const activeTab = tab ?? (paid ? "monthly" : "payg");
  const packs = billing?.pricing.packs ?? [];
  const bestPackKey = packs[packs.length - 1]?.key;
  const walletLeft = billing?.wallet?.balanceSeconds ?? 0;
  const status = billing?.subscription ?? null;
  const canCancel = (plan === "starter" || plan === "power" || plan === "pro") && status?.status === "active";
  const tierPricing =
    plan === "starter" || plan === "pro"
      ? billing?.pricing.starter
      : plan === "power"
        ? billing?.pricing.power
        : null;
  const usage = billing?.usage ?? null;
  const left = usage && !usage.unlimited ? usage.remainingSeconds : null;
  const limitMinutes = usage?.limitSeconds ? Math.max(1, Math.round(usage.limitSeconds / 60)) : null;
  const usedPct =
    usage?.limitSeconds && usage.limitSeconds > 0
      ? Math.min(100, Math.round((usage.usedSeconds / usage.limitSeconds) * 100))
      : 0;

  const summary = loading
    ? "Checking your plan."
    : enterprise
      ? "Enterprise listening is unlimited for your workspace."
      : payg
        ? `${formatAllowance(walletLeft)} in your wallet. Minutes never expire.`
        : paid
          ? status
            ? planNote(status)
            : `${planName(plan)} is active.`
          : `Free includes ${limitMinutes ?? 100} listening minutes, once, and every note stays yours.`;

  return (
    <>
      <section className="card mt-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-accent-soft text-accent">
              {paid ? (
                <ShieldCheck className="h-5 w-5" />
              ) : payg ? (
                <Wallet className="h-5 w-5" />
              ) : (
                <CreditCard className="h-5 w-5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-ink">Your plan</h2>
                <span
                  className={
                    paid || payg
                      ? "chip border-transparent bg-accent-soft text-accent"
                      : "chip border-line text-muted"
                  }
                >
                  {loading ? "Checking" : payg ? "Pay as you go" : planName(plan)}
                </span>
              </div>
              <p className="mt-1 max-w-[52ch] text-[13.5px] leading-5 text-muted">{summary}</p>
              {left !== null && limitMinutes !== null && (
                <div className="mt-2 max-w-[320px]">
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised-2">
                    <div
                      className={left > 0 ? "h-full rounded-full bg-accent" : "h-full rounded-full bg-rec"}
                      style={{ width: `${left <= 0 ? 100 : usedPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[12.5px] leading-4 text-faint">
                    {left <= 0
                      ? payg
                        ? "Your wallet is empty. Buy a pack to keep listening."
                        : paid
                          ? `${planName(plan)} listening is finished for this month. It resets at the start of next month.`
                          : "Your free minutes are finished. Starter Pro and Power User unlock more listening."
                      : payg
                        ? `${formatAllowance(left)} left in your wallet. You are only charged when a recording saves.`
                        : paid
                          ? `${formatAllowance(left)} left of ${formatAllowance(usage?.limitSeconds ?? 0)} this month.`
                          : `${formatAllowance(left)} of free listening left.`}
                  </p>
                </div>
              )}
              {billing && enterprise && (
                <p className="mt-1 text-[12.5px] text-faint">Enterprise plan. Billed per seat each month.</p>
              )}
              {billing && tierPricing && (
                <p className="mt-1 text-[12.5px] text-faint">
                  {naira.format(tierPricing.naira)} a month, about ${tierPricing.usd}. Billed in{" "}
                  {billing.pricing.currency === "NGN" ? "Naira" : billing.pricing.currency}.
                </p>
              )}
              {billing && !paid && !payg && (
                <p className="mt-1 text-[12.5px] leading-4 text-faint">
                  Starter Pro is {naira.format(billing.pricing.starter.naira)} a month, Power User is{" "}
                  {naira.format(billing.pricing.power.naira)}. Or buy minutes as you go.
                </p>
              )}
            </div>
          </div>

          {!loading && billing && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {canCancel && (
                <button
                  type="button"
                  className="btn btn-line btn-sm w-full sm:w-auto"
                  onClick={() => setConfirmCancel(true)}
                  disabled={busy || !billing.configured}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Cancel renewal
                </button>
              )}
              {billing.configured && !enterprise && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-full sm:w-auto"
                  onClick={() => void checkPayment()}
                  disabled={busy}
                  title="Ask Paystack for the latest payment state"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Check payment
                </button>
              )}
            </div>
          )}

          {loading && (
            <span className="flex items-center gap-2 self-start rounded-full border border-line bg-raised-2 px-3 py-1.5 text-[12.5px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking
            </span>
          )}
        </div>

        {billing && !billing.configured && !paid && (
          <div className="mt-4 rounded-xl border border-line bg-raised-2 p-3.5">
            <p className="text-[13.5px] leading-5 text-soft">
              Payments are not switched on yet. Your free plan keeps working, and paid plans will appear here once
              they are ready.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
            <p className="text-[13px] leading-5 text-soft">{error}</p>
          </div>
        )}

        {!enterprise && (
          <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-4 text-faint">
            <ShieldCheck className="mt-px h-3 w-3 flex-none" />
            Payments are handled by Paystack. JotBox never sees your card details.
          </p>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-faint">
          <Link to="/refunds" className="tap-link underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink">
            Cancellation and refunds
          </Link>
          <Link to="/terms" className="tap-link underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink">
            Terms
          </Link>
          <Link to="/privacy" className="tap-link underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink">
            Privacy
          </Link>
        </p>
      </section>

      {!loading && billing && !enterprise && (
        <section className="card mt-4 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-ink">Choose how you pay</h2>
              <p className="mt-1 text-[13.5px] leading-5 text-muted">
                Switch anytime. Minutes you already bought stay in your wallet.
              </p>
            </div>
            <div
              className="inline-flex w-full rounded-xl border border-line bg-raised-2 p-1 sm:w-auto"
              role="tablist"
              aria-label="How you pay"
            >
              {(["monthly", "payg"] as const).map((option) => {
                const active = activeTab === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`flex-1 rounded-lg px-4 py-1.5 text-[13px] transition-colors sm:flex-none ${
                      active ? "bg-accent font-semibold text-accent-ink" : "font-medium text-muted hover:text-ink"
                    }`}
                    onClick={() => setTab(option)}
                  >
                    {option === "monthly" ? "Monthly" : "Pay as you go"}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === "payg" ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-soft">
                <span className="font-medium text-ink">No subscription.</span>
                <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden="true" />
                <span>Minutes never expire.</span>
                <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden="true" />
                <span>You only pay when a recording saves.</span>
              </div>

              {billing.mode === "monthly" && (
                <div className="mt-3 rounded-xl border border-line bg-raised-2 px-3 py-2.5 text-[13px] leading-5 text-soft">
                  You are on {planName(plan)}. Pay as you go turns on when your plan ends.
                </div>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {packs.map((pack) => {
                  const best = pack.key === bestPackKey;
                  return (
                    <div
                      key={pack.key}
                      className={`flex flex-col rounded-2xl border bg-raised p-4 ${
                        best ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]" : "border-line"
                      }`}
                    >
                      {best && (
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-accent">Best value</p>
                      )}
                      <p
                        className={`text-[21px] font-semibold tracking-[-0.03em] text-ink ${
                          best ? "mt-0.5" : ""
                        }`}
                      >
                        {pack.minutes.toLocaleString("en-NG")} min
                      </p>
                      <p className="mt-0.5 text-[17px] font-semibold text-ink">{naira.format(pack.naira)}</p>
                      <p className="mt-0.5 text-[12px] text-faint">{naira.format(pack.perMinuteNaira)} a minute</p>
                      <ul className="mt-3 space-y-1.5 text-[12.5px] leading-4 text-soft">
                        {["Never expires", "Live words and full report", "Charged on save"].map((line) => (
                          <li key={line} className="flex items-start gap-1.5">
                            <Check className="mt-px h-3.5 w-3.5 flex-none text-accent" />
                            {line}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className={`btn btn-sm mt-4 w-full ${best ? "btn-primary" : "btn-line"}`}
                        onClick={() => void buyMinutes(pack)}
                        disabled={Boolean(buying) || busy || !billing.configured || billing.mode === "monthly"}
                      >
                        {buying === pack.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Buy {pack.minutes.toLocaleString("en-NG")} minutes
                      </button>
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 text-[12px] leading-4 text-faint">
                Pay as you go covers listening. Branded PDF, AI follow-up drafts, calendar, Jira, and organisation
                Ask stay on monthly plans.
              </p>
            </>
          ) : (
            <>
              <div className="mt-5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="text-[14px] font-medium text-ink">Monthly plans</p>
                <p className="text-[12.5px] text-faint">For people who record most weeks. Cancels anytime.</p>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    key: "starter" as const,
                    label: "Starter Pro",
                    usd: billing.pricing.starter.usd,
                    naira: billing.pricing.starter.naira,
                    hours: "10 hours a month",
                    features: ["Branded PDF and AI follow-ups", "Calendar and Jira"],
                  },
                  {
                    key: "power" as const,
                    label: "Power User",
                    usd: billing.pricing.power.usd,
                    naira: billing.pricing.power.naira,
                    hours: "25 hours a month",
                    features: ["Everything in Starter Pro", "Best for daily recording"],
                  },
                ].map((option) => {
                  const current = plan === option.key;
                  return (
                    <div
                      key={option.key}
                      className={`flex flex-col rounded-2xl border bg-raised p-4 sm:p-5 ${
                        current ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]" : "border-line"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-semibold text-ink">{option.label}</p>
                        <span className="chip text-muted">${option.usd}</span>
                      </div>
                      <p className="mt-1.5 text-[17px] font-semibold text-ink">
                        {naira.format(option.naira)} a month
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-faint">{option.hours}</p>
                      <ul className="mt-3 space-y-1.5 text-[12.5px] leading-4 text-soft">
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-px h-3.5 w-3.5 flex-none text-accent" />
                          Resets monthly
                        </li>
                        {option.features.map((line) => (
                          <li key={line} className="flex items-start gap-1.5">
                            <Check className="mt-px h-3.5 w-3.5 flex-none text-accent" />
                            {line}
                          </li>
                        ))}
                      </ul>
                      {current ? (
                        <button type="button" className="btn btn-line btn-sm mt-4 w-full" disabled>
                          Current plan
                        </button>
                      ) : paid ? (
                        <p className="mt-4 text-[12px] text-faint">Manage your plan above.</p>
                      ) : (
                        <button
                          type="button"
                          className={`btn btn-sm mt-4 w-full ${
                            option.key === "starter" ? "btn-primary" : "btn-line"
                          }`}
                          onClick={() => void upgrade(option.key)}
                          disabled={busy || !billing.configured}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Upgrade to {option.label}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {payg && (
                <p className="mt-3 text-[12px] leading-4 text-faint">
                  A monthly plan takes over while it is active. Minutes you already bought stay in your wallet.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title={`Stop your ${planName(plan)} renewal?`}
        description="You keep your plan until the end of the period you already paid for. After that, the free plan takes over and your notes stay yours."
        confirmLabel="Stop renewal"
        tone="danger"
        onConfirm={() => void stopRenewal()}
        onCancel={() => setConfirmCancel(false)}
      />
    </>
  );
}

function AccountView({ user }: { user: CloudUser }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const sessions = useSessions((state) => state.sessions);
  const { status, lastSyncedAt, error } = useSync();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const own = sessions.filter((session) => !session.id.startsWith("sample-"));
  const minutes = Math.round(own.reduce((total, session) => total + session.durationSec, 0) / 60);
  const notes = own.filter((session) => session.notes).length;

  const handleSignOut = async () => {
    setConfirmSignOut(false);
    setSigningOut(true);
    try {
      await signOut();
      toast.success("Signed out");
      navigate("/auth", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="page-enter w-full">
      <p className="kicker">Account</p>
      <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
        Your JotBox account.
      </h1>
      <p className="mt-1 text-[15px] text-muted">Your notes follow you. Recordings stay on this device.</p>

      <PlanCard />

      <IntegrationsCard />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr] xl:gap-6">
        <section className="card p-5 sm:p-6">
          <div className="flex items-start gap-3.5">
            <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-accent text-[17px] font-semibold text-accent-ink">
              {initialsFor(user)}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-ink">
                {user.name || "JotBox member"}
              </h2>
              <p className="mt-0.5 truncate text-[14.5px] text-muted">{user.email}</p>
              {user.createdAt && (
                <p className="mt-1 text-[12.5px] text-faint">Member since {format(user.createdAt, "MMMM yyyy")}</p>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              { label: "Sessions", value: own.length },
              { label: "Minutes", value: minutes },
              { label: "With notes", value: notes },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-line bg-raised-2 p-3">
                <p className="text-[18px] font-semibold leading-none text-ink">{item.value}</p>
                <p className="mt-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/app" className="btn btn-primary btn-sm">
              Open JotBox
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              className="btn btn-line btn-sm"
              onClick={() => setConfirmSignOut(true)}
              disabled={signingOut}
            >
              {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Sign out
            </button>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-ink">Notes across devices</h2>
              <p className="mt-1 text-[13.5px] leading-5 text-muted">Notes, jottings, and words.</p>
            </div>
            <SyncChip />
          </div>

          <div className="mt-4 rounded-xl border border-line bg-raised-2 p-3.5">
            <div className="flex items-center gap-2 text-[14px] text-soft">
              <Cloud className="h-4 w-4 text-accent" />
              {status === "syncing"
                ? "Sending your latest notes…"
                : status === "error"
                  ? "Updates are paused."
                  : status === "ready"
                    ? "Everything is up to date."
                    : "Your notes will update shortly."}
            </div>
            <p className="mt-1.5 text-[12.5px] text-faint">
              {lastSyncedAt
                ? Date.now() - lastSyncedAt < 10_000
                  ? "Updated just now."
                  : `Last updated ${formatDistanceToNowStrict(lastSyncedAt, { addSuffix: true })}.`
                : "Not updated yet."}
            </p>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
              <p className="text-[13px] leading-5 text-soft">{error}</p>
            </div>
          )}

          <button
            type="button"
            className="btn btn-line btn-sm mt-4 w-full"
            onClick={() => {
              requestCloudSync();
              toast.success("Updating now");
            }}
            disabled={status === "syncing"}
          >
            {status === "syncing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh notes
          </button>

          <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-4 text-faint">
            <ShieldCheck className="mt-px h-3 w-3 flex-none" />
            Recordings stay on this device. Notes follow your account.
          </p>
        </section>
      </div>

      <p className="mt-4 text-center text-[12.5px] text-faint">
        Signing out removes the copy on this device. Your notes remain in your account.
      </p>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of JotBox?"
        description="The copy of your notes and recordings on this device will be removed. Your notes stay safe in your account."
        confirmLabel="Sign out"
        tone="danger"
        onConfirm={() => void handleSignOut()}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}

export default function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <AccountView user={user} />;
}
