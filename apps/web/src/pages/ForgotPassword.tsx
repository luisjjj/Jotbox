import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Loader2, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Brand } from "@/components/Brand";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Reset your password · JotBox";
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.forgotPassword(email.trim());
      setSent(result.message);
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
        {sent ? (
          <div className="card p-6 sm:p-7">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <Mail className="h-5 w-5" />
            </span>
            <h1 className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-ink">Check your email</h1>
            <p className="mt-2.5 text-[14.5px] leading-6 text-muted">{sent}</p>
            <p className="mt-2 text-[13px] leading-5 text-faint">
              The link expires in 60 minutes. If it does not arrive, check spam, then try again.
            </p>
            <Link to="/auth" className="btn btn-primary mt-6 w-full">
              Back to sign in
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <p className="kicker">Account recovery</p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[38px]">
              Forgot your password?
            </h1>
            <p className="mt-3 text-[15px] leading-6 text-muted">
              Enter the email you signed up with. We will send a link to choose a new password.
            </p>

            <form className="mt-6 space-y-3.5" onSubmit={(event) => void onSubmit(event)}>
              <div>
                <label className="label" htmlFor="forgot-email">
                  Email
                </label>
                <input
                  id="forgot-email"
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

              {error && (
                <div className="rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
                  <p className="text-[13.5px] leading-5 text-soft">{error}</p>
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {submitting ? "Sending…" : "Send the reset link"}
              </button>
            </form>

            <p className="mt-5 text-[13px] leading-5 text-faint">
              Remembered it?{" "}
              <Link to="/auth" className="font-medium text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
