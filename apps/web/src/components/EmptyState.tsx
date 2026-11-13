import type { ReactNode } from "react";
import clsx from "clsx";

export function EmptyState({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-raised-2 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-raised text-muted shadow-sm">
        {icon}
      </div>
      <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[22rem] text-[15px] leading-6 text-muted">{body}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

