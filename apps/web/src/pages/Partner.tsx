import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Link2, Loader2, Lock, Users, Wallet } from "lucide-react";
import { useParams } from "react-router-dom";
import { Brand } from "@/components/Brand";
import { api, ApiError, type PartnerDashboard } from "@/lib/api";

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function money(kobo: number) {
  return naira.format(Math.round((Number(kobo) || 0) / 100));
}

function formatDate(value: number | null) {
  if (!value) return "No payment yet";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-accent-soft text-accent"
      : status === "ending" || status === "attention"
        ? "bg-highlight text-brass"
        : "bg-raised-2 text-muted";
  const label =
    status === "active"
      ? "Pro"
      : status === "ending"
        ? "Ending"
        : status === "attention"
          ? "Needs attention"
          : status === "cancelled"
            ? "Cancelled"
            : status === "completed"
              ? "Completed"
              : "Free";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="card px-4 py-4">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink">{value}</p>
    </div>
  );
}

export default function Partner() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PartnerDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Partner dashboard \u00b7 JotBox";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .getPartnerDashboard(token)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof ApiError ? caught.message : "This link could not be opened.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function copyLink() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.partner.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4">
        <div className="flex items-center gap-2 text-[14px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening your dashboard
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4">
        <div className="w-full max-w-[440px] rounded-2xl border border-line bg-raised p-6 text-center shadow-sm">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-raised-2 text-faint">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-[19px] font-semibold tracking-[-0.02em] text-ink">
            This partner link is not valid
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
            {error || "Ask the JotBox team for a fresh dashboard link."}
          </p>
          <a href="/" className="btn btn-line mt-4 inline-flex w-full justify-center">
            Go to JotBox
          </a>
        </div>
      </div>
    );
  }

  const { partner, stats, referrals, payments, payouts } = data;
  const percent = Number.isInteger(partner.commissionPercent)
    ? partner.commissionPercent
    : partner.commissionPercent.toFixed(1);

  return (
    <div className="min-h-dvh bg-paper px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
      <div className="mx-auto w-full max-w-[1120px]">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Brand />
          <span className="chip">
            <Wallet className="h-3.5 w-3.5" />
            Partner dashboard
          </span>
        </header>

        <section className="mt-5 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
          <div className="rounded-[1.1rem] bg-accent px-5 py-6 text-accent-ink shadow-sm sm:px-7 sm:py-7">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] opacity-70">
              Partner · {percent}% commission
            </p>
            <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[40px]">
              {partner.name}
            </h1>
            <p className="mt-2 max-w-[46ch] text-[14.5px] leading-relaxed opacity-80 sm:text-[15px]">
              You earn {percent}% of every Pro payment from people who sign up with your link. JotBox pays you
              manually, so this page is your running record.
            </p>
            <div className="mt-6">
              <p className="text-[11.5px] uppercase tracking-[0.16em] opacity-70">Balance due</p>
              <p className="mt-0.5 text-[36px] font-semibold tracking-[-0.04em] sm:text-[46px]">
                {money(stats.balanceKobo)}
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
              <span className="rounded-full bg-white/[0.12] px-3 py-1">Earned {money(stats.commissionKobo)}</span>
              <span className="rounded-full bg-white/[0.12] px-3 py-1">Paid out {money(stats.paidOutKobo)}</span>
            </div>
          </div>

          <div className="card p-5 sm:p-6">
            <p className="kicker">Your link</p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
              Share this link. Anyone who signs up after opening it is counted for you.
            </p>
            <div className="mt-3 rounded-xl border border-line bg-raised-2 px-3 py-3">
              <code className="block break-all text-[13.5px] font-medium text-ink">{partner.link}</code>
            </div>
            <button type="button" className="btn btn-primary mt-3 w-full" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy referral link"}
            </button>
            <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-faint">
              <Link2 className="mt-0.5 h-3.5 w-3.5 flex-none" />
              The link remembers a visitor for 90 days, so they can look around before they sign up.
            </p>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Sign-ups" value={String(stats.signups)} icon={<Users className="h-4 w-4" />} />
          <Stat
            label="Paying people"
            value={String(stats.paying)}
            icon={<span className="text-[13px] font-semibold">%</span>}
          />
          <Stat label="Active Pro" value={String(stats.active)} icon={<Check className="h-4 w-4" />} />
          <Stat label="Collected" value={money(stats.grossKobo)} icon={<Wallet className="h-4 w-4" />} />
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">People you referred</h2>
              <span className="chip">{stats.signups}</span>
            </div>
            {referrals.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-line bg-raised-2 px-4 py-6 text-center text-[14px] text-muted">
                No sign-ups yet. Share your link to get started.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {referrals.map((person) => (
                  <li key={`${person.email}-${person.joinedAt}`} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] font-medium text-ink">{person.email}</p>
                      <p className="mt-0.5 text-[12.5px] text-faint">
                        Joined {formatDate(person.joinedAt)}
                        {person.payments > 0 ? ` \u00b7 ${person.payments} payment${person.payments === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-2 text-right">
                      <div>
                        <p className="text-[14px] font-semibold text-ink">{money(person.commissionKobo)}</p>
                        <p className="text-[11.5px] text-faint">your share</p>
                      </div>
                      <StatusChip status={person.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Recent payments</h2>
              <span className="chip">{money(stats.commissionKobo)} earned</span>
            </div>
            {payments.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-line bg-raised-2 px-4 py-6 text-center text-[14px] text-muted">
                When someone upgrades, the payment and your share appear here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {payments.map((payment) => (
                  <li
                    key={payment.reference}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] font-medium text-ink">{payment.email}</p>
                      <p className="mt-0.5 text-[12.5px] text-faint">{formatDate(payment.paidAt)}</p>
                    </div>
                    <div className="flex-none text-right">
                      <p className="text-[14px] font-semibold text-ink">{money(payment.amountKobo)}</p>
                      <p className="text-[11.5px] font-medium text-accent">+{money(payment.commissionKobo)} for you</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {payouts.length > 0 && (
          <section className="card mt-4 p-5 sm:p-6">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Payouts sent</h2>
            <ul className="mt-3 divide-y divide-line">
              {payouts.map((payout) => (
                <li key={payout.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[14.5px] font-medium text-ink">{money(payout.amountKobo)}</p>
                    <p className="mt-0.5 text-[12.5px] text-faint">
                      {formatDate(payout.paidAt)}
                      {payout.note ? ` \u00b7 ${payout.note}` : ""}
                    </p>
                  </div>
                  <span className="chip">Paid</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 text-center text-[12.5px] leading-relaxed text-faint">
          Private dashboard for {partner.name}. Keep this page link to yourself. Customer emails are shortened for
          privacy.
        </p>
      </div>
    </div>
  );
}
