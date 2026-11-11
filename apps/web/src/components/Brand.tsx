import clsx from "clsx";
import { Link } from "react-router-dom";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "grid flex-none place-items-center rounded-[0.7rem] bg-accent text-accent-ink shadow-sm",
        className ?? "h-8 w-8",
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none">
        <rect x="3.5" y="9.5" width="2.6" height="5" rx="1.3" fill="currentColor" opacity="0.55" />
        <rect x="8.2" y="5.5" width="2.6" height="13" rx="1.3" fill="currentColor" />
        <rect x="12.9" y="8" width="2.6" height="8" rx="1.3" fill="currentColor" opacity="0.9" />
        <rect x="17.6" y="10.5" width="2.6" height="3" rx="1.3" fill="currentColor" opacity="0.55" />
      </svg>
    </span>
  );
}

export function Brand({ to = "/", compact = false }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-2.5" aria-label="JotBox home">
      <BrandMark className="h-8 w-8 transition-transform group-hover:-rotate-3" />
      {!compact && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-[16px] font-semibold tracking-[-0.035em] text-ink">JotBox</span>
          <span className="rounded-full border border-line px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">
            beta
          </span>
        </span>
      )}
    </Link>
  );
}
