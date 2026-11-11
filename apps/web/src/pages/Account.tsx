import { useState, type FormEvent } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { BrandMark } from "@/components/Brand";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { requestCloudSync } from "@/components/CloudSync";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import type { CloudUser } from "@/lib/api";

type Mode = "login" | "register";

function initialsFor(user: CloudUser) {
  const source = user.name.trim() || user.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "J").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function SyncChip() {
  const status = useSync((state) => state.status);
  const label =
    status === "ready"
      ? "Synced"
      : status === "syncing"
        ? "Syncing"
        : status === "error"
          ? "Sync issue"
          : "Off";
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
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="mx-auto max-w-[880px]">
      <p className="kicker">Account</p>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[30px]">
        Your JotBox account.
      </h1>
      <p className="mt-1 text-[13px] text-muted">Notes and transcripts follow you. Audio stays on this device.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
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
              <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-ink">Cloud sync</h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">Jottings, transcripts, and notes.</p>
            </div>
            <SyncChip />
          </div>

          <div className="mt-4 rounded-xl border border-line bg-raised-2 p-3.5">
            <div className="flex items-center gap-2 text-[12px] text-soft">
              <Cloud className="h-4 w-4 text-accent" />
              {status === "syncing"
                ? "Sending changes to your account…"
                : status === "error"
                  ? "Sync is paused."
                  : status === "ready"
                    ? "Everything is up to date."
                    : "Sync starts when you sign in."}
            </div>
            <p className="mt-1.5 text-[10.5px] text-faint">
              {lastSyncedAt
                ? Date.now() - lastSyncedAt < 10_000
                  ? "Synced just now."
                  : `Last synced ${formatDistanceToNowStrict(lastSyncedAt, { addSuffix: true })}.`
                : "No sync yet."}
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
              toast.success("Syncing now");
            }}
            disabled={status === "syncing"}
          >
            {status === "syncing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync now
          </button>

          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-faint">
            <ShieldCheck className="mt-px h-3 w-3 flex-none" />
            Audio stays on this device. Notes and transcripts sync to your account.
          </p>
        </section>
      </div>

      <p className="mt-4 text-center text-[10.5px] text-faint">
        Signing out removes the local copy from this device. Your notes remain in your account.
      </p>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of JotBox?"
        description="The local copy of your notes and audio will be removed from this device. Your notes and transcripts stay safe in your account."
        confirmLabel="Sign out"
        tone="danger"
        onConfirm={() => void handleSignOut()}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}

function AuthForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
        toast.success("Welcome back");
      } else {
        await signUp(name.trim(), email.trim(), password);
        toast.success("Your account is ready");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[960px]">
      <p className="kicker">Account</p>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
        Keep your notes beyond this device.
      </h1>
      <p className="mt-1.5 max-w-[48ch] text-[13px] leading-6 text-muted">
        Sign in to sync sessions across your phone and computer. Audio stays local; notes and transcripts follow you.
      </p>

      <div className="card mt-6 overflow-hidden">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
          <div className="hero-ink relative hidden flex-col justify-between p-8 lg:flex">
            <div className="hero-grid pointer-events-none absolute inset-0" />
            <div className="relative">
              <div className="flex items-center gap-2.5">
                <BrandMark className="h-9 w-9" />
                <span className="text-[16px] font-semibold tracking-[-0.03em]">JotBox</span>
              </div>
              <h2 className="mt-8 max-w-[16ch] font-serif text-[30px] leading-[1.08] text-[#f5f1e4]">
                A quiet place for everything you heard.
              </h2>
              <p className="mt-4 max-w-[34ch] text-[12.5px] leading-6 text-[#c5d0c7]">
                Your jottings and the written notes stay together, ready when you open the app on another device.
              </p>
            </div>
            <div className="relative mt-8 space-y-3">
              {[
                { Icon: Cloud, text: "Sessions, notes, and transcripts sync" },
                { Icon: ShieldCheck, text: "Passwords hashed, sessions expire" },
                { Icon: Lock, text: "Audio never leaves this device" },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2.5 text-[11.5px] text-[#d8e2d8]">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-white/[0.06]">
                    <item.Icon className="h-3 w-3" />
                  </span>
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="seg w-full">
              <button
                type="button"
                className="seg-item flex-1"
                data-active={mode === "login"}
                onClick={() => switchMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                className="seg-item flex-1"
                data-active={mode === "register"}
                onClick={() => switchMode("register")}
              >
                Create account
              </button>
            </div>

            <form className="mt-5 space-y-3.5" onSubmit={(event) => void onSubmit(event)}>
              {mode === "register" && (
                <div>
                  <label className="label" htmlFor="account-name">
                    Name
                  </label>
                  <input
                    id="account-name"
                    className="field"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ada Okafor"
                    autoComplete="name"
                    maxLength={80}
                  />
                </div>
              )}
              <div>
                <label className="label" htmlFor="account-email">
                  Email
                </label>
                <input
                  id="account-email"
                  className="field"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </div>
              <div>
                <label className="label" htmlFor="account-password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="account-password"
                    className="field pr-11"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    required
                    minLength={mode === "register" ? 8 : 1}
                    maxLength={200}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-raised-2 hover:text-ink"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {mode === "register" && (
                <div>
                  <label className="label" htmlFor="account-confirm">
                    Confirm password
                  </label>
                  <input
                    id="account-confirm"
                    className="field"
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="Type it again"
                    autoComplete="new-password"
                    required
                    maxLength={200}
                  />
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
                  <p className="text-[11.5px] leading-5 text-soft">{error}</p>
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === "login" ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {submitting ? "Working…" : mode === "login" ? "Sign in" : "Create my account"}
              </button>
            </form>

            <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-4 text-faint">
              <ShieldCheck className="mt-px h-3 w-3 flex-none" />
              Sessions use secure, httpOnly cookies. Passwords are hashed with scrypt. Audio never uploads to the
              account.
            </p>
            <p className="mt-3 text-[11px] text-muted">
              Nothing to sync?{" "}
              <Link to="/app" className="font-medium text-ink underline decoration-line-strong underline-offset-2">
                Keep using JotBox on this device
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto max-w-[880px] pt-10">
        <div className="card flex items-center gap-3 p-6">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <p className="text-[13px] text-muted">Checking your account…</p>
        </div>
      </div>
    );
  }

  return user ? <AccountView user={user} /> : <AuthForm />;
}

