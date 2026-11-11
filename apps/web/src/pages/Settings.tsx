import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Check,
  Download,
  HardDrive,
  Info,
  Loader2,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "react-hot-toast";
import { APP_CONFIG, AI_CONFIG } from "@jotbox/config";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStudio, refreshStudio } from "@/hooks/useStudio";
import { deleteAudio } from "@/lib/audioStore";
import { loadSampleSessions } from "@/lib/seed";
import { useSessions } from "@/lib/store";
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
  const studio = useStudio();
  const sessions = useSessions((state) => state.sessions);
  const location = useLocation();
  const [checking, setChecking] = useState(false);
  const [studioOverride, setStudioOverride] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const connected = studioOverride ?? studio;
  const audioCount = sessions.filter((session) => session.hasAudio).length;

  useEffect(() => {
    if (location.hash !== "#studio") return;
    const element = document.getElementById("studio");
    if (element) element.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [location.hash]);

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

  const checkStudio = async () => {
    setChecking(true);
    try {
      const value = await refreshStudio();
      setStudioOverride(value);
      toast.success(value ? "Studio AI is connected" : "Studio AI is off — draft mode is active");
    } catch {
      toast.error("Could not reach the studio endpoint.");
    } finally {
      setChecking(false);
    }
  };

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

  const clearAll = () => {
    const state = useSessions.getState();
    for (const session of state.sessions) {
      if (session.hasAudio) void deleteAudio(session.id);
    }
    state.clear();
    setConfirmClear(false);
    toast.success("Sessions and audio cleared from this device");
  };

  return (
    <div className="mx-auto max-w-[760px]">
      <p className="kicker">Settings</p>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[30px]">
        How JotBox behaves.
      </h1>
      <p className="mt-1 text-[13px] text-muted">Appearance, studio connection, and the data kept on this device.</p>

      <div className="mt-6 space-y-4">
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
          id="studio"
          title="Studio AI"
          description="Studio transcription reads recordings and call tabs, then writes the finished notes. Without it, JotBox still captures live captions and drafts notes on this device."
          aside={
            <span
              className={clsx(
                "chip border-transparent",
                connected ? "bg-accent-soft text-accent" : "bg-raised-2 text-muted",
              )}
            >
              <span
                className={clsx("h-1.5 w-1.5 rounded-full", connected ? "bg-[#3e7a5b]" : "bg-faint")}
              />
              {connected === null ? "Checking" : connected ? "Connected" : "Draft mode"}
            </span>
          }
        >
          <div className="rounded-xl border border-line bg-raised-2 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brass" />
              <p className="text-[12.5px] font-medium text-ink">
                {connected === null
                  ? "Looking for the studio endpoint…"
                  : connected
                    ? "Studio transcription is on."
                    : "Studio transcription is off."}
              </p>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
              {connected
                ? `Audio is sent to ${AI_CONFIG.sttModel} for transcription, then ${AI_CONFIG.notesModel} writes the notes. Audio still lives on this device first.`
                : "Add an XAI_API_KEY to the server environment to turn on uploads, tab transcription, and studio-written notes. Live captions and draft notes keep working without it."}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <code className="rounded-md border border-line bg-raised px-2 py-1 text-[10.5px] text-muted">
                XAI_API_KEY
              </code>
              <button type="button" className="btn btn-line btn-sm" onClick={() => void checkStudio()} disabled={checking}>
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Check again
              </button>
            </div>
          </div>
        </Section>

        <Section
          title="Data on this device"
          description="Sessions, notes, and audio are kept in this browser. Nothing syncs to an account."
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
            <button
              type="button"
              className="btn btn-sm ml-auto text-rec hover:bg-rec-soft"
              onClick={() => setConfirmClear(true)}
              disabled={!sessions.length && audioCount === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear everything
            </button>
          </div>
          <p className="mt-2.5 text-[10.5px] leading-4 text-faint">
            Exports include notes and transcripts as JSON. Audio stays in this browser and is not part of the export.
          </p>
        </Section>

        <section className="rounded-2xl border border-line bg-raised-2/70 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line bg-raised text-muted">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-[13.5px] font-semibold text-ink">What leaves this device</h2>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
                Nothing, unless studio transcription is on. When it is, audio is sent to the model provider for that
                one session. Live captions are handled by your browser's speech engine. JotBox has no account, no
                analytics, and no cloud library.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-[10.5px] text-faint">
          <span className="flex items-center gap-1.5">
            <Info className="h-3 w-3" />
            {APP_CONFIG.name} v{APP_CONFIG.version} · {APP_CONFIG.description}
          </span>
          <span>Local only</span>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this device?"
        description="Every session, note, transcript, and audio file in this browser will be deleted. Export first if you want a copy. This cannot be undone."
        confirmLabel="Clear everything"
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
