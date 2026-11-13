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
  Sparkles,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { requestCloudSync } from "@/components/CloudSync";
import { api, type BillingStatus, type CloudUser } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { useUsage } from "@/lib/usageStore";

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
      ? `Pro stays on until ${format(status.nextPaymentAt, "d MMM yyyy")}. It will not renew.`
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
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref") || "";
    const returning = params.get("billing") === "callback" || Boolean(reference);

    const load = async () => {
      try {
        if (returning && reference) {
          const result = await api.verifyCheckout(reference);
          setBilling(result);
          useUsage.getState().applyStatus(result);
          if (result.payment === "success" && result.plan === "pro") {
            toast.success("Pro is active. Thank you.");
          } else {
            toast.error("That payment was not completed.");
          }
        } else {
          const result = await api.billingStatus();
          setBilling(result);
          useUsage.getState().applyStatus(result);
          if (returning) toast("No payment was made.");
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

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.startCheckout();
      window.location.assign(session.authorizationUrl);
    } catch (upgradeError) {
      const message = errorText(upgradeError);
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const stopRenewal = async () => {
    setConfirmCancel(false);
    setBusy(true);
    setError(null);
    try {
      setBilling(await api.cancelSubscription());
      toast.success("Renewal stopped. You keep Pro until the period ends.");
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
      toast.success(result.plan === "pro" ? "Pro is active." : "Checked with Paystack. Nothing new yet.");
    } catch (checkError) {
      const message = errorText(checkError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const paid = billing?.plan === "pro";
  const status = billing?.subscription ?? null;
  const canCancel = paid && status?.status === "active";
  const price = billing ? naira.format(billing.pricing.naira) : "";
  const usage = billing?.usage ?? null;
  const freeLeft = usage && !usage.unlimited ? usage.remainingSeconds : null;
  const freeLimitMinutes = usage?.limitSeconds ? Math.max(1, Math.round(usage.limitSeconds / 60)) : null;
  const usedPct =
    usage?.limitSeconds && usage.limitSeconds > 0
      ? Math.min(100, Math.round((usage.usedSeconds / usage.limitSeconds) * 100))
      : 0;

  const summary = loading
    ? "Checking your plan."
    : paid
      ? status
        ? planNote(status)
        : "Pro is active."
      : `Free covers ${freeLimitMinutes ?? 60} minutes a month, and every note stays yours.`;

  return (
    <>
      <section className="card mt-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-accent-soft text-accent">
              {paid ? <Sparkles className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-ink">Your plan</h2>
                <span
                  className={
                    paid
                      ? "chip border-transparent bg-accent-soft text-accent"
                      : "chip border-line text-muted"
                  }
                >
                  {paid ? "Pro" : loading ? "Checking" : "Free"}
                </span>
              </div>
              <p className="mt-1 max-w-[52ch] text-[13.5px] leading-5 text-muted">{summary}</p>
              {freeLeft !== null && freeLimitMinutes !== null && (
                <div className="mt-2 max-w-[320px]">
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised-2">
                    <div
                      className={freeLeft > 0 ? "h-full rounded-full bg-accent" : "h-full rounded-full bg-rec"}
                      style={{ width: `${freeLeft <= 0 ? 100 : usedPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[12.5px] leading-4 text-faint">
                    {freeLeft <= 0
                      ? "Free minutes are finished for this month. Pro lifts the cap."
                      : `${formatMinutes(freeLeft)} left of ${freeLimitMinutes} minutes this month.`}
                  </p>
                </div>
              )}
              {billing && paid && (
                <p className="mt-1 text-[12.5px] text-faint">
                  {price} a month. Billed in {billing.pricing.currency === "NGN" ? "Naira" : billing.pricing.currency}.
                </p>
              )}
              {billing && !paid && (
                <p className="mt-1 text-[12.5px] text-faint">
                  Pro is {price} a month, about ${billing.pricing.usd}. Billed in{" "}
                  {billing.pricing.currency === "NGN" ? "Naira" : billing.pricing.currency}.
                </p>
              )}
            </div>
          </div>

          {!loading && billing && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {!paid && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm w-full sm:w-auto"
                  onClick={() => void upgrade()}
                  disabled={busy || !billing.configured}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  Upgrade to Pro
                </button>
              )}
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
              {billing.configured && (
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
              Payments are not switched on yet. Your free plan keeps working, and Pro will appear here once it is
              ready.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
            <p className="text-[13px] leading-5 text-soft">{error}</p>
          </div>
        )}

        <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-4 text-faint">
          <ShieldCheck className="mt-px h-3 w-3 flex-none" />
          Payments are handled by Paystack. JotBox never sees your card details.
        </p>
      </section>

      <ConfirmDialog
        open={confirmCancel}
        title="Stop your Pro renewal?"
        description="You keep Pro until the end of the period you already paid for. After that, the free plan takes over and your notes stay yours."
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
