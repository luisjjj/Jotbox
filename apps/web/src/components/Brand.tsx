import clsx from "clsx";
import { Link } from "react-router-dom";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "brand-mark grid flex-none place-items-center rounded-[0.7rem] shadow-sm",
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

export function Brand({
  to = "/",
  compact = false,
  tone = "default",
}: {
  to?: string;
  compact?: boolean;
  tone?: "default" | "onDark";
}) {
  const onDark = tone === "onDark";
  return (
    <Link to={to} className="group inline-flex items-center gap-2.5" aria-label="JotBox home">
      <BrandMark
        className={clsx(
          "h-8 w-8 transition-transform group-hover:-rotate-3",
          onDark && "bg-white/10 text-[#f5f1e4] shadow-none",
        )}
      />
      {!compact && (
        <span
          className={clsx(
            "text-[18px] font-semibold tracking-[-0.035em]",
            onDark ? "text-[#f5f1e4]" : "text-ink",
          )}
        >
          JotBox
        </span>
      )}
    </Link>
  );
}
