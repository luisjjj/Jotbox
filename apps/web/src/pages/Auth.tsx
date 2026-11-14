import { useEffect, useState, type FormEvent } from "react";
import { Navigate, Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Check, Eye, EyeOff, Loader2, Lock, Sparkles, User } from "lucide-react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { Brand, BrandMark } from "@/components/Brand";
import { desktopBridge } from "@/lib/desktop";

type Mode = "login" | "register";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/auth")) return "/app";
  return value;
}

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [desktop] = useState(() => desktopBridge());
  const onDesktop = Boolean(desktop);

  useEffect(() => {
    if (!desktop || loading) return;
    desktop.shellReady();
  }, [desktop, loading]);

  if (loading) {
    if (onDesktop) {
      return (
        <div className="desktop-auth">
          <div className="flex flex-col items-center gap-4">
            <BrandMark className="h-12 w-12 rounded-2xl" />
            <Loader2 className="h-5 w-5 animate-spin text-[#9fb5a4]" />
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4">
        <div className="flex flex-col items-center gap-4">
          <BrandMark className="h-12 w-12 rounded-2xl" />
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      </div>
    );
  }

  if (user) return <Navigate to={next} replace />;

  const switchMode = (value: Mode) => {
    setMode(value);
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
      navigate(next, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const form = (
    <>
      <div className="seg mt-7 w-full">
        <button type="button" className="seg-item flex-1" data-active={mode === "login"} onClick={() => switchMode("login")}>
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
            <label className="label" htmlFor="auth-name">
              Name
            </label>
            <input
              id="auth-name"
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
          <label className="label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
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
          <label className="label" htmlFor="auth-password">
            Password
          </label>
          <div className="relative">
            <input
              id="auth-password"
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
            <label className="label" htmlFor="auth-confirm">
              Confirm password
            </label>
            <input
              id="auth-confirm"
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
            <p className="text-[13.5px] leading-5 text-soft">{error}</p>
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
    </>
  );

  if (onDesktop) {
    return (
      <div className="desktop-auth" data-desktop-auth="true">
        <div className="desktop-auth-card">
          <div className="flex items-center gap-3">
            <BrandMark className="h-11 w-11 rounded-[0.95rem]" />
            <div className="min-w-0">
              <p className="text-[16px] font-semibold tracking-[-0.03em] text-ink">JotBox</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Windows desktop</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-line bg-raised-2 px-2.5 py-1 text-[11px] font-medium text-muted">
              v{desktop?.version ?? "0.1.0"}
            </span>
          </div>

          <h1 className="mt-7 text-[27px] font-semibold leading-[1.15] tracking-[-0.04em] text-ink">
            {mode === "login" ? "Sign in to start listening." : "Create your account."}
          </h1>
          <p className="mt-1.5 text-[14px] leading-5 text-muted">
            {mode === "login"
              ? "The island and your notes are waiting on this PC."
              : "One account for every room. Free to start."}
          </p>

          {form}

          <p className="mt-6 flex items-start gap-2 border-t border-line pt-4 text-[12px] leading-4 text-faint">
            <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
            Recordings stay on this PC. Notes and jottings sync to your account.
          </p>
        </div>
        <p className="mt-5 text-center text-[11.5px] text-white/40">JotBox for Windows</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Brand />
        <Link to="/" className="btn btn-ghost btn-sm">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back home
        </Link>
      </header>

      <main className="page-enter mx-auto grid max-w-[1120px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12 lg:py-12 lg:px-8">
        <div className="hero-ink relative hidden overflow-hidden rounded-[1.6rem] p-8 shadow-float lg:block lg:min-h-[560px]">
          <div className="hero-grid pointer-events-none absolute inset-0" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <BrandMark className="h-9 w-9" />
                <span className="text-[18px] font-semibold tracking-[-0.03em]">JotBox</span>
              </div>
              <h1 className="mt-10 max-w-[13ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.045em] text-[#f5f1e4]">
                Your notes, wherever you are.
              </h1>
              <p className="mt-4 max-w-[34ch] text-[15px] leading-6 text-[#c5d0c7]">
                Sign in once and every room, lecture, and call follows you to the next device.
              </p>
            </div>
            <div className="space-y-3">
              {[
                { Icon: Check, text: "Notes and jottings stay together" },
                { Icon: Lock, text: "Recordings stay on your device" },
                { Icon: Sparkles, text: "JotBox writes the summary and actions" },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2.5 text-[13.5px] text-[#d8e2d8]">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-white/[0.06]">
                    <item.Icon className="h-3 w-3" />
                  </span>
                  {item.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[430px]">
          <div className="mb-7 lg:hidden">
            <BrandMark className="h-11 w-11 rounded-2xl" />
          </div>
          <p className="kicker">Welcome to JotBox</p>
          <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.04em] text-ink sm:text-[38px]">
            {mode === "login" ? "Sign in to your notes." : "Create your account."}
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-muted">
            {mode === "login"
              ? "Your rooms, lectures, and calls are waiting on the other side."
              : "One account for every room. Free to start."}
          </p>

          {form}

          <p className="mt-5 text-[12.5px] leading-4 text-faint">
            Your recordings stay on your device. Notes and jottings sync to your account.
          </p>
        </div>
      </main>
    </div>
  );
}
