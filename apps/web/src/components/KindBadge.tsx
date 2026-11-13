import clsx from "clsx";
import { AudioLines, GraduationCap, Presentation, Users, type LucideIcon } from "lucide-react";
import { KIND_META } from "@/lib/format";
import type { SessionKind } from "@/lib/types";

interface KindStyle {
  Icon: LucideIcon;
  tile: string;
  dot: string;
}

const STYLES: Record<SessionKind, KindStyle> = {
  meeting: {
    Icon: Users,
    tile: "bg-[#ecf1f6] text-[#3c566c] dark:bg-[#1b2831] dark:text-[#a9c5d9]",
    dot: "bg-[#4c6f8c]",
  },
  seminar: {
    Icon: Presentation,
    tile: "bg-[#f6efe2] text-[#7a5a26] dark:bg-[#2d2618] dark:text-[#dfbf83]",
    dot: "bg-[#a17c3c]",
  },
  lecture: {
    Icon: GraduationCap,
    tile: "bg-[#e9f1ea] text-[#2c5942] dark:bg-[#1d2b22] dark:text-[#a9c9b3]",
    dot: "bg-[#3e7a5b]",
  },
  voice: {
    Icon: AudioLines,
    tile: "bg-[#f2edf4] text-[#5e3d66] dark:bg-[#281f2c] dark:text-[#ceb0d6]",
    dot: "bg-[#7d5687]",
  },
};

export function KindTile({ kind, className }: { kind: SessionKind; className?: string }) {
  const { Icon, tile } = STYLES[kind];
  return (
    <span
      className={clsx("grid h-9 w-9 flex-none place-items-center rounded-[0.6rem]", tile, className)}
      aria-hidden="true"
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: SessionKind; className?: string }) {
  const { Icon } = STYLES[kind];
  return <Icon className={clsx("h-4 w-4", className)} strokeWidth={1.9} aria-hidden="true" />;
}

export function KindBadge({ kind, className }: { kind: SessionKind; className?: string }) {
  const { Icon, tile } = STYLES[kind];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold tracking-[-0.01em]",
        tile,
        className,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      {KIND_META[kind].label}
    </span>
  );
}

export function KindDot({ kind, className }: { kind: SessionKind; className?: string }) {
  return <span className={clsx("h-1.5 w-1.5 flex-none rounded-full", STYLES[kind].dot, className)} aria-hidden="true" />;
}
