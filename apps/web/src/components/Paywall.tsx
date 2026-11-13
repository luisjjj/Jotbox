import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Modal } from "./Modal";
import { useUsage } from "@/lib/usageStore";

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function priceLine(usd: number | null, nairaAmount: number | null) {
  if (nairaAmount) return `${naira.format(nairaAmount)} a month, about $${usd ?? 7}.`;
  return `$${usd ?? 7} a month.`;
}

export function PaywallDialog({
  open,
  onClose,
  title,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
}) {
  const pricing = useUsage((state) => state.pricing);
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-accent bg-accent-soft p-3.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-raised text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium text-ink">Pro opens this up</p>
            <p className="mt-0.5 text-[13.5px] leading-5 text-soft">
              {priceLine(pricing?.usd ?? null, pricing?.naira ?? null)} Everything on the free plan stays yours.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-line" onClick={onClose}>
            Not now
          </button>
          <Link to="/account" className="btn btn-primary" onClick={onClose}>
            See Pro
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </Modal>
  );
}

export function PaywallPanel({
  title,
  description,
  className = "",
}: {
  title: string;
  description: string;
  className?: string;
}) {
  const pricing = useUsage((state) => state.pricing);
  return (
    <section className={`card flex flex-col items-center justify-center px-5 py-12 text-center ${className}`}>
      <span className="grid h-12 w-12 place-items-center rounded-full border border-line bg-raised-2 text-accent">
        <Lock className="h-5 w-5" />
      </span>
      <h2 className="mt-3 max-w-[24ch] text-[19px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <p className="mt-1.5 max-w-[42ch] text-[14.5px] leading-6 text-muted">{description}</p>
      <p className="mt-2 text-[12.5px] text-faint">
        {priceLine(pricing?.usd ?? null, pricing?.naira ?? null)} Cancel anytime.
      </p>
      <Link to="/account" className="btn btn-primary mt-4">
        See Pro
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
