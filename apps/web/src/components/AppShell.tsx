import { useEffect, useMemo } from "react";
import clsx from "clsx";
import {
  ArrowRight,
  Home,
  Layers,
  Library,
  Mic,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { APP_CONFIG } from "@jotbox/config";
import { useEngine } from "@/engine/SessionEngine";
import { useStudio } from "@/hooks/useStudio";
import { loadSampleSessions } from "@/lib/seed";
import { useIsDark, setTheme } from "@/lib/theme";
import { useSessions } from "@/lib/store";
import { Brand } from "./Brand";
import { CaptureDock } from "./CaptureDock";
import { FloatWindow } from "./FloatWindow";
import { SessionRow } from "./SessionRow";

const NAV = [
  { to: "/", label: "Home", Icon: Home, end: true },
  { to: "/library", label: "Library", Icon: Library, end: false },
  { to: "/float", label: "Float mode", Icon: Layers, end: false },
  { to: "/settings", label: "Settings", Icon: Settings, end: false },
];

function isNavActive(pathname: string, item: (typeof NAV)[number]) {
  if (item.to === "/") return pathname === "/";
  if (item.to === "/library") return pathname === "/library" || pathname.startsWith("/session");
  return pathname.startsWith(item.to);
}

function StudioLine() {
  const studio = useStudio();
  return (
    <Link
      to="/settings#studio"
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px] text-muted transition-colors hover:bg-raised-2"
      title="Transcription and studio notes run on the server when an API key is configured."
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 flex-none rounded-full",
          studio === null ? "bg-faint" : studio ? "bg-[#3e7a5b]" : "bg-faint",
        )}
      />
      <span className="truncate">
        {studio === null ? "Checking studio…" : studio ? "Studio AI connected" : "Draft mode · on this device"}
      </span>
    </Link>
  );
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const sessions = useSessions((state) => state.sessions);
  const { status } = useEngine();
  const isDark = useIsDark();

  const recent = useMemo(
    () => [...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [sessions],
  );

  const addExample = () => {
    loadSampleSessions();
    toast.success("Example notes added");
    navigate("/session/sample-meeting");
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-line bg-raised lg:flex">
      <div className="px-5 pb-4 pt-6">
        <Brand />
      </div>

      <div className="px-3">
        <Link
          to="/listen"
          className={clsx("btn w-full justify-between", status === "recording" || status === "paused" ? "btn-line" : "btn-primary")}
        >
          <span className="flex items-center gap-2">
            {status === "recording" || status === "paused" ? (
              <span className="live-dot" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {status === "recording" || status === "paused" ? "Back to studio" : "New capture"}
          </span>
          <span
            className={clsx(
              "grid h-5 w-5 place-items-center rounded-md text-[11px]",
              status === "recording" || status === "paused" ? "bg-rec-soft text-rec" : "bg-white/15",
            )}
          >
            <Mic className="h-3 w-3" />
          </span>
        </Link>
      </div>

      <nav className="mt-5 px-3" aria-label="Workspace">
        <p className="kicker px-2.5 pb-1.5">Workspace</p>
        {NAV.map((item) => {
          const active = isNavActive(location.pathname, item);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={clsx(
                "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-[0.55rem] text-[13px] font-medium transition-colors",
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised-2 hover:text-ink",
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex items-center justify-between px-5">
        <p className="kicker">Recent</p>
        <Link to="/library" className="text-[11px] font-medium text-muted transition-colors hover:text-ink">
          View all
        </Link>
      </div>

      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto px-2 pb-3 scroll-quiet">
        {recent.length === 0 ? (
          <button
            type="button"
            onClick={addExample}
            className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-start gap-2 rounded-xl border border-dashed border-line-strong px-3 py-3 text-left transition-colors hover:bg-raised-2"
          >
            <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-md bg-accent-soft text-accent">
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
            <span>
              <span className="block text-[12px] font-medium text-ink">Nothing here yet</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-faint">Open an example to see the notes.</span>
            </span>
          </button>
        ) : (
          recent.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              compact
              active={location.pathname === `/session/${session.id}`}
              showStatus={false}
            />
          ))
        )}
      </div>

      <div className="border-t border-line px-3 py-3">
        <StudioLine />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="icon-btn h-8 w-8"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label={isDark ? "Switch to light appearance" : "Switch to dark appearance"}
              title={isDark ? "Light appearance" : "Dark appearance"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="flex items-center gap-1 px-1 text-[10.5px] text-faint">
              <ShieldCheck className="h-3 w-3" />
              On device
            </span>
          </div>
          <span className="pr-1 text-[10px] tabular-nums text-faint">v{APP_CONFIG.version}</span>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader() {
  const isDark = useIsDark();

  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Brand />
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "Switch to light appearance" : "Switch to dark appearance"}
          >
            {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <Link to="/settings" className="icon-btn" aria-label="Settings">
            <Settings className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function MobileNav() {
  const location = useLocation();
  const { status } = useEngine();
  const recording = status === "recording" || status === "paused";

  const left = NAV.slice(0, 2);
  const right = NAV.slice(2);

  const renderItem = (item: (typeof NAV)[number]) => {
    const active = isNavActive(location.pathname, item);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={clsx(
          "flex min-h-[3.1rem] flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium",
          active ? "text-accent" : "text-muted",
        )}
        aria-current={active ? "page" : undefined}
      >
        <item.Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.1 : 1.8} />
        {item.label === "Float mode" ? "Float" : item.label}
      </NavLink>
    );
  };

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised/95 backdrop-blur-md lg:hidden"
      aria-label="Primary"
    >
      <div className="grid grid-cols-5 items-center px-1.5 pt-1">
        {left.map(renderItem)}
        <Link to="/listen" className="flex flex-col items-center gap-0.5 pb-1" aria-label="Start a capture">
          <span
            className={clsx(
              "-mt-5 grid h-12 w-12 place-items-center rounded-full border-[3px] border-raised shadow-lg transition-colors",
              recording ? "bg-rec text-white" : "bg-accent text-accent-ink",
            )}
          >
            <Mic className="h-[19px] w-[19px]" strokeWidth={2} />
          </span>
          <span className={clsx("text-[10px] font-semibold", recording ? "text-rec" : "text-accent")}>
            {recording ? "Studio" : "Capture"}
          </span>
        </Link>
        {right.map(renderItem)}
      </div>
    </nav>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function AppShell() {
  return (
    <div className="min-h-dvh bg-paper">
      <ScrollToTop />
      <Sidebar />
      <div className="lg:pl-[272px]">
        <MobileHeader />
        <main className="mx-auto w-full max-w-[1200px] px-4 pb-32 pt-5 sm:px-6 lg:px-10 lg:pb-20 lg:pt-9">
          <Outlet />
        </main>
      </div>
      <CaptureDock />
      <FloatWindow />
      <MobileNav />
    </div>
  );
}
