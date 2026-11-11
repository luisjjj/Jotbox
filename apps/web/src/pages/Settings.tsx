import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, Cloud, Download, HardDrive, Monitor, Moon, Plus, ShieldCheck, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { APP_CONFIG } from "@jotbox/config";
import { useAuth } from "@/auth/AuthProvider";
import { loadSampleSessions } from "@/lib/seed";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { setTheme, useTheme, type ThemeChoice } from "@/lib/theme";

const THEMES: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

function mb(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function Section({
  id,
  title,
  description,
  children,
  aside,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          <p className="mt-1 max-w-[48ch] text-[12px] leading-5 text-muted">{description}</p>
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function Settings() {
  const theme = useTheme();
  const sessions = useSessions((state) => state.sessions);
  const { user } = useAuth();
  const syncStatus = useSync((state) => state.status);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

  const audioCount = sessions.filter((session) => session.hasAudio).length;

  useEffect(() => {
    let alive = true;
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (alive) setUsage({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessions.length]);

  const exportAll = () => {
    const payload = {
      app: "JotBox",
      version: APP_CONFIG.version,
      exportedAt: new Date().toISOString(),
      sessions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jotbox-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success("Export downloaded");
  };

  return (
    <div className="w-full">
      <p className="kicker">Settings</p>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[30px]">
        How JotBox behaves.
      </h1>
      <p className="mt-1 text-[13px] text-muted">Account, appearance, and the data kept on this device.</p>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:items-start">
        <div className="space-y-4">
          <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">
              {(user?.name.trim()[0] ?? user?.email[0] ?? "J").toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[13.5px] font-semibold text-ink">{user?.name.trim() || user?.email}</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <Cloud className="h-3 w-3" />
                {syncStatus === "syncing"
                  ? "Updating your notes…"
                  : syncStatus === "error"
                    ? "Couldn't update notes just now"
                    : "Notes are up to date"}
              </p>
            </div>
          </div>
          <Link to="/account" className="btn btn-line btn-sm">
            Manage account
          </Link>
        </section>

        <Section title="Appearance" description="JotBox follows your system by default. The choice is remembered here.">
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((option) => {
              const active = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  aria-pressed={active}
                  className={clsx(
                    "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-raised-2 hover:border-line-strong",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <option.Icon className={clsx("h-4 w-4", active ? "text-accent" : "text-muted")} />
                    {active && <Check className="h-3.5 w-3.5 text-accent" />}
                  </span>
                  <span className="text-[12px] font-medium text-ink">{option.label}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          title="Data on this device"
          description="Audio stays in this browser. Notes and jottings follow you to your account."
          aside={
            <span className="chip">
              <HardDrive className="h-3 w-3" />
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </span>
          }
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-raised-2 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Sessions</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-ink">{sessions.length}</p>
            </div>
            <div className="rounded-xl border border-line bg-raised-2 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Audio files</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-ink">{audioCount}</p>
            </div>
            <div className="rounded-xl border border-line bg-raised-2 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Storage used</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-ink">
                {usage ? mb(usage.used) : "—"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-line btn-sm" onClick={exportAll} disabled={!sessions.length}>
              <Download className="h-3.5 w-3.5" />
              Export notes
            </button>
            <button
              type="button"
              className="btn btn-line btn-sm"
              onClick={() => {
                loadSampleSessions();
                toast.success("Example sessions added to the library");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add examples
            </button>
          </div>
          <p className="mt-2.5 text-[10.5px] leading-4 text-faint">
            Exports include notes and spoken words as a file. Audio stays in this browser and is not part of the export.
            Signing out removes this device’s copy; your notes remain in your account.
          </p>
        </Section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-9">
        <section className="rounded-2xl border border-line bg-raised-2 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line bg-raised text-muted">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-[13.5px] font-semibold text-ink">What leaves this device</h2>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
                Your notes and jottings follow you to your JotBox account. Recordings stay on this device. When you ask
                JotBox to write notes, that recording is sent for writing and nothing else.
              </p>
            </div>
          </div>
        </section>

        <p className="flex items-center gap-1.5 px-1 pb-2 text-[10.5px] text-faint">
          <ShieldCheck className="h-3 w-3" />
          Recordings stay on this device. Notes follow you only when you sign in.
        </p>
        </div>
      </div>
    </div>
  );
}

