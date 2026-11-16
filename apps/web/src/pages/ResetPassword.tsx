import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Brand } from "@/components/Brand";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Choose a new password · JotBox";
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword({ token, password });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          <Link to="/auth" className="btn btn-ghost btn-sm">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[460px] px-4 py-10 sm:py-16">
        {!token ? (
          <div className="card p-6 sm:p-7">
            <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-ink">That link is incomplete</h1>
            <p className="mt-2.5 text-[14.5px] leading-6 text-muted">
              This page needs the full reset link from your email. Ask for a new one and open it from the message.
            </p>
            <Link to="/forgot-password" className="btn btn-primary mt-6 w-full">
              Send a new link
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : done ? (
          <div className="card p-6 sm:p-7">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <Check className="h-5 w-5" />
            </span>
            <h1 className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-ink">Password changed</h1>
            <p className="mt-2.5 text-[14.5px] leading-6 text-muted">
              Sign in with your new password. Every other device has been signed out.
            </p>
            <Link to="/auth" className="btn btn-primary mt-6 w-full">
              Sign in
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <p className="kicker">Account recovery</p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[38px]">
              Choose a new password
            </h1>
            <p className="mt-3 text-[15px] leading-6 text-muted">
              Use at least 8 characters. Signing in elsewhere will need the new password.
            </p>

            <form className="mt-6 space-y-3.5" onSubmit={(event) => void onSubmit(event)}>
              <div>
                <label className="label" htmlFor="reset-password">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="reset-password"
                    className="field pr-11"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                    minLength={8}
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
              <div>
                <label className="label" htmlFor="reset-confirm">
                  Confirm new password
                </label>
                <input
                  id="reset-confirm"
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

              {error && (
                <div className="rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
                  <p className="text-[13.5px] leading-5 text-soft">{error}</p>
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {submitting ? "Saving…" : "Save the new password"}
              </button>
            </form>

            <p className="mt-5 text-[13px] leading-5 text-faint">
              Link expired?{" "}
              <Link to="/forgot-password" className="font-medium text-accent hover:underline">
                Ask for another
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
