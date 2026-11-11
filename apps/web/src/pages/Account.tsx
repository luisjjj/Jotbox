import { useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AlertCircle, ArrowRight, Check, Cloud, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { requestCloudSync } from "@/components/CloudSync";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import type { CloudUser } from "@/lib/api";

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
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[30px]">
        Your JotBox account.
      </h1>
      <p className="mt-1 text-[13px] text-muted">Your notes follow you. Recordings stay on this device.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr] xl:gap-6">
        <section className="card p-5 sm:p-6">
          <div className="flex items-start gap-3.5">
            <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-accent text-[15px] font-semibold text-accent-ink">
              {initialsFor(user)}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-ink">
                {user.name || "JotBox member"}
              </h2>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">{user.email}</p>
              {user.createdAt && (
                <p className="mt-1 text-[10.5px] text-faint">Member since {format(user.createdAt, "MMMM yyyy")}</p>
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
                <p className="text-[16px] font-semibold leading-none text-ink">{item.value}</p>
                <p className="mt-1.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-faint">{item.label}</p>
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
              <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-ink">Notes across devices</h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">Notes, jottings, and words.</p>
            </div>
            <SyncChip />
          </div>

          <div className="mt-4 rounded-xl border border-line bg-raised-2 p-3.5">
            <div className="flex items-center gap-2 text-[12px] text-soft">
              <Cloud className="h-4 w-4 text-accent" />
              {status === "syncing"
                ? "Sending your latest notes…"
                : status === "error"
                  ? "Updates are paused."
                  : status === "ready"
                    ? "Everything is up to date."
                    : "Your notes will update shortly."}
            </div>
            <p className="mt-1.5 text-[10.5px] text-faint">
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
              <p className="text-[11px] leading-5 text-soft">{error}</p>
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

          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-faint">
            <ShieldCheck className="mt-px h-3 w-3 flex-none" />
            Recordings stay on this device. Notes follow your account.
          </p>
        </section>
      </div>

      <p className="mt-4 text-center text-[10.5px] text-faint">
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
