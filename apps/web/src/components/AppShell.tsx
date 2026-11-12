import { useEffect, useMemo } from "react";
import clsx from "clsx";
import {
  ArrowRight,
  BrainCircuit,
  ChevronRight,
  Home,
  Layers,
  Library,
  Mic,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  User,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { useEngine } from "@/engine/SessionEngine";
import { loadSampleSessions } from "@/lib/seed";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { setTheme, useIsDark } from "@/lib/theme";
import { Brand } from "./Brand";
import { CaptureDock } from "./CaptureDock";
import { FloatWindow } from "./FloatWindow";
import { ScrollProgress } from "./ScrollProgress";
import { SessionRow } from "./SessionRow";

const NAV = [
  { to: "/app", label: "Home", Icon: Home, end: true },
  { to: "/library", label: "Library", Icon: Library, end: false },
  { to: "/memory", label: "Memory", Icon: BrainCircuit, end: false },
  { to: "/float", label: "Keep on top", Icon: Layers, end: false },
  { to: "/settings", label: "Settings", Icon: Settings, end: false },
];

const MOBILE_NAV = NAV.filter((item) => item.to !== "/settings");

function isNavActive(pathname: string, item: (typeof NAV)[number]) {
  if (item.to === "/app") return pathname === "/app";
  if (item.to === "/library") return pathname === "/library" || pathname.startsWith("/session");
  return pathname.startsWith(item.to);
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const sessions = useSessions((state) => state.sessions);
  const { status } = useEngine();
  const { user } = useAuth();
  const syncStatus = useSync((state) => state.status);
  const isDark = useIsDark();

  const recent = useMemo(
    () => [...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [sessions],
  );

  const accountLabel = user?.name.trim() || user?.email || "Your account";
  const accountDetail =
    syncStatus === "syncing" ? "Updating your notes…" : syncStatus === "error" ? "Couldn't update notes" : "Notes up to date";
  const initials = user
    ? (user.name.trim().split(/\s+/)[0]?.[0] ?? user.email[0]).toUpperCase() +
      (user.name.trim().split(/\s+/)[1]?.[0] ?? "").toUpperCase()
    : "";

  const addExample = () => {
    loadSampleSessions();
    toast.success("Example notes added");
    navigate("/session/sample-meeting");
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-line bg-raised lg:flex">
      <div className="px-5 pb-4 pt-6">
        <Brand to="/app" />
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
            {status === "recording" || status === "paused" ? "Back to recording" : "New capture"}
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
        <Link
          to="/account"
          className={clsx(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-raised-2",
            location.pathname === "/account" && "bg-raised-2",
          )}
        >
          <span
            className={clsx(
              "grid h-8 w-8 flex-none place-items-center rounded-full text-[11px] font-semibold",
              user ? "bg-accent text-accent-ink" : "border border-line bg-raised-2 text-muted",
            )}
          >
            {user ? initials : <User className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">{accountLabel}</span>
            <span className="mt-0.5 block truncate text-[10px] text-faint">{accountDetail}</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 flex-none text-faint" />
        </Link>
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
              Private
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader() {
  const isDark = useIsDark();
  const { user } = useAuth();
  const initials = user
    ? (user.name.trim()[0] ?? user.email[0]).toUpperCase() + (user.name.trim().split(/\s+/)[1]?.[0] ?? "").toUpperCase()
    : "";

  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-paper backdrop-blur-md lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Brand to="/app" />
        <div className="flex items-center gap-1">
          <Link to="/account" className="icon-btn" aria-label={user ? "Account" : "Sign in"}>
            {user ? (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-ink">
                {initials}
              </span>
            ) : (
              <User className="h-[18px] w-[18px]" />
            )}
          </Link>
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

  const left = MOBILE_NAV.slice(0, 2);
  const right = MOBILE_NAV.slice(2);

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
        {item.label === "Keep on top" ? "On top" : item.label}
      </NavLink>
    );
  };

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised backdrop-blur-md lg:hidden"
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
            {recording ? "Recording" : "Capture"}
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
  const location = useLocation();
  return (
    <div className="min-h-dvh bg-paper">
      <ScrollProgress />
      <ScrollToTop />
      <Sidebar />
      <div className="lg:pl-[272px]">
        <MobileHeader />
        <main className="mx-auto w-full max-w-[1560px] px-4 pb-32 pt-5 sm:px-6 lg:px-10 lg:pb-20 lg:pt-9 xl:px-12 2xl:max-w-[1760px] 2xl:px-16">
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
      <CaptureDock />
      <FloatWindow />
      <MobileNav />
    </div>
  );
}

