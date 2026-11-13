import { useEffect, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  BrainCircuit,
  Building2,
  Check,
  Cloud,
  Globe2,
  Layers,
  Lock,
  Mail,
  Menu,
  Mic,
  MonitorUp,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Brand, BrandMark } from "@/components/Brand";
import { Reveal } from "@/components/Reveal";
import { ScrollProgress } from "@/components/ScrollProgress";
import { StaticBars } from "@/components/Waveform";
import { formatClock } from "@/lib/format";

function ChromeBar({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-line bg-raised-2 px-4 py-2.5">
      <span className="h-2 w-2 rounded-full bg-[#e5a09a]" />
      <span className="h-2 w-2 rounded-full bg-[#e7cf9e]" />
      <span className="h-2 w-2 rounded-full bg-[#a9c9ae]" />
      <span className="ml-2 rounded-md border border-line bg-raised px-2 py-0.5 text-[11px] text-faint">{label}</span>
    </div>
  );
}

const LIVE_LINES = [
  { who: "Ada", text: "Ah, wetin happen to the Friday payout?" },
  { who: "Chinedu", text: "The file reach the bank late, so the window shift." },
  { who: "Ada", text: "No wahala, make we pause the same-day promise." },
  { who: "You", text: "I go send the merchant note before four." },
];

const MARQUEE = [
  "Meetings",
  "Lectures",
  "Seminars",
  "Voice notes",
  "Call tabs",
  "Pidgin",
  "Yoruba",
  "Igbo",
  "Hausa",
  "English",
  "Code-switching",
  "The room, as it sounded",
];

const STEPS = [
  {
    Icon: Mic,
    title: "Start listening",
    body: "Use the microphone in the room, or share a Meet, Zoom, or Teams tab and include its sound. JotBox keeps the audio and the live words.",
  },
  {
    Icon: Sparkles,
    title: "Jot the few lines that matter",
    body: "A decision, a name, a number, something you owe someone. Short lines become the spine of the written notes. Typing is optional.",
  },
  {
    Icon: AudioLines,
    title: "Stop and read",
    body: "JotBox writes the summary, key points, actions, and sections. Keep it on your device, or sign in and open it anywhere.",
  },
];

const FEATURES = [
  {
    Icon: Mic,
    title: "Room or call",
    body: "The microphone for lectures and meetings. Shared sound for calls. Upload a recording if you already have one.",
  },
  {
    Icon: AudioLines,
    title: "Two panes",
    body: "Your jottings on one side, the live words on the other. On a phone they become simple tabs.",
  },
  {
    Icon: Layers,
    title: "Stays on top",
    body: "Keep a small pill above your slides, editor, or call on a computer. Keep working.",
  },
  {
    Icon: ShieldCheck,
    title: "Private by default",
    body: "Recordings stay on the device. Notes travel only when you choose to sign in.",
  },
];

const FREE_FEATURES = [
  "60 minutes of listening a month",
  "Written notes for every session",
  "Jottings and spoken words side by side",
  "Notes stay on this device",
];

const PRO_FEATURES = [
  "Unlimited listening",
  "Pidgin and code-switching kept intact",
  "Notes follow you across devices",
  "Export to PDF and Markdown",
  "Notes ready the moment you stop",
  "Email support",
];

const TEAM_FEATURES = [
  "Everything in Pro, for every seat",
  "Organisational memory across meetings",
  "Admin, roles, and meeting-level access",
  "Retention rules and an audit trail",
  "Guided rollout and onboarding",
  "Priority support",
];

function LivePidginCard() {
  const [beat, setBeat] = useState(1);
  const [seconds, setSeconds] = useState(24);

  useEffect(() => {
    const words = window.setInterval(() => setBeat((value) => (value + 1) % (LIVE_LINES.length + 1)), 2600);
    const clock = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => {
      window.clearInterval(words);
      window.clearInterval(clock);
    };
  }, []);

  const visible = LIVE_LINES.slice(Math.max(0, beat - 2), Math.min(LIVE_LINES.length, beat + 1));

  return (
    <div className="relative">
      <div className="hero-orb absolute -right-6 -top-8 h-40 w-40 rounded-full bg-[#d6b97d]/20 blur-3xl" />
      <div className="hero-orb-slow absolute -bottom-10 left-6 h-44 w-44 rounded-full bg-[#7fae95]/20 blur-3xl" />

      <div className="relative rounded-2xl border border-white/15 bg-white/[0.07] p-4 shadow-float backdrop-blur-md">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.13em] text-[#dfe9dc]">
            <span className="live-dot" />
            Listening
          </span>
          <span className="text-[13px] font-medium tabular-nums text-[#c5d0c7]">{formatClock(seconds)}</span>
        </div>

        <div className="mt-3 flex items-end gap-1.5">
          <StaticBars
            className="h-9 flex-1 text-[#dcead9]"
            heights={[0.3, 0.55, 0.85, 0.45, 0.7, 1, 0.6, 0.35, 0.8, 0.5, 0.3, 0.65, 0.9, 0.4, 0.75, 0.55, 0.3, 0.7]}
          />
          <span className="chip !min-h-0 border-white/15 !bg-white/[0.08] !px-2 !py-1 !text-[11px] !text-[#dfe9dc]">
            <Globe2 className="h-2.5 w-2.5" />
            Pidgin + English
          </span>
        </div>

        <div className="mt-4 min-h-[112px] space-y-2.5">
          {visible.map((line) => (
            <p key={line.text} className="ticker text-[13px] leading-5 text-[#d8e2d8]">
              <span className="font-semibold text-[#dcc69b]">{line.who}</span>
              <span className="mx-1.5 text-[#8ea796]">·</span>
              {line.text}
            </p>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-[#0c261f]/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#a6b5a8]">Writing your notes</span>
            <span className="flex items-center gap-1 text-[11px] text-[#a6b5a8]">
              <Sparkles className="h-2.5 w-2.5" />
              Tone kept
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-4/5 rounded-full bg-white/20" />
            <div className="h-1.5 w-3/5 rounded-full bg-white/10" />
          </div>
          <p className="mt-2 text-[12px] leading-4 text-[#c5d0c7]">
            “No wahala, make we pause the same-day promise.” Kept as it was said.
          </p>
        </div>
      </div>

      <div className="absolute -bottom-5 -left-3 hidden items-center gap-2 rounded-full border border-white/15 bg-[#0c261f] px-3 py-1.5 text-[11.5px] font-medium text-[#ece8da] shadow-lg sm:flex">
        <span className="live-dot" />
        Notes ready when you stop
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const [menuOpen, setMenuOpen] = useState(false);

  const appHref = signedIn ? "/app" : "/auth?next=%2Fapp";
  const startHref = signedIn ? "/listen" : "/auth?next=%2Flisten";
  const exampleHref = signedIn ? "/app?demo=1" : "/auth?next=%2Fapp%3Fdemo%3D1";
  const memoryHref = signedIn ? "/memory" : "/auth?next=%2Fmemory";
  const accountHref = signedIn ? "/account" : "/auth?next=%2Faccount";
  const authHref = "/auth?next=%2Fapp";

  useEffect(() => {
    document.title = "JotBox: the notes are written while you listen";
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <ScrollProgress />
      <header className="sticky top-0 z-40 bg-[#12362c]">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand tone="onDark" />
          <nav className="hidden items-center gap-6 text-[14px] font-medium text-[#c5d0c7] md:flex">
            <a href="#how" className="nav-link nav-link-hero transition-colors hover:text-[#f5f1e4]">
              How it works
            </a>
            <a href="#pidgin" className="nav-link nav-link-hero transition-colors hover:text-[#f5f1e4]">
              Pidgin &amp; tone
            </a>
            <a href="#result" className="nav-link nav-link-hero transition-colors hover:text-[#f5f1e4]">
              The notes
            </a>
            <a href="#memory" className="nav-link nav-link-hero transition-colors hover:text-[#f5f1e4]">
              Memory
            </a>
            <a href="#pricing" className="nav-link nav-link-hero transition-colors hover:text-[#f5f1e4]">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-1.5">
            {!signedIn && (
              <Link to={authHref} className="btn btn-hero-line btn-sm hidden sm:inline-flex">
                Sign in
              </Link>
            )}
            <Link to={appHref} className="btn btn-cream btn-sm hidden sm:inline-flex">
              {signedIn ? "Open JotBox" : "Get started"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              className="icon-btn icon-btn-hero md:hidden"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id="landing-menu" className="mobile-sheet border-t border-line bg-paper px-4 pb-5 pt-3 md:hidden">
            <nav className="flex flex-col">
              {[
                { href: "#how", label: "How it works" },
                { href: "#pidgin", label: "Pidgin & tone" },
                { href: "#result", label: "The notes" },
                { href: "#memory", label: "Memory" },
                { href: "#pricing", label: "Pricing" },
                { href: "#privacy", label: "Privacy" },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between border-b border-line py-3 text-[15px] font-medium text-soft"
                >
                  {item.label}
                  <ArrowRight className="h-3.5 w-3.5 text-faint" />
                </a>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-2">
              <Link to={appHref} className="btn btn-primary w-full" onClick={() => setMenuOpen(false)}>
                {signedIn ? "Open JotBox" : "Get started free"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {!signedIn && (
                <Link to={authHref} className="btn btn-line w-full" onClick={() => setMenuOpen(false)}>
                  Sign in
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="hero-top-flat relative overflow-hidden">
          <div className="hero-grid pointer-events-none absolute inset-0" />
          <div className="hero-orb absolute -left-24 top-4 h-64 w-64 rounded-full bg-[#2f705b]/35 blur-3xl" />
          <div className="hero-orb-slow absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-[#d6b97d]/20 blur-3xl" />
          <div className="relative mx-auto max-w-[1320px] px-4 pb-8 pt-7 sm:px-6 sm:pb-12 sm:pt-10 lg:px-8 lg:pb-16 lg:pt-14">
            <div className="grid gap-9 lg:grid-cols-[1.04fr_0.96fr] lg:items-center">
              <div className="fade-up flex flex-col items-start">
                <h1 className="max-w-[18ch] text-[2.7rem] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f5f1e4] sm:text-[3.6rem]">
                  The notes are written <em className="font-normal italic text-[#dcc69b]">while you listen.</em>
                </h1>
                <p className="mt-4 max-w-[42ch] text-[15.5px] leading-6 text-[#c5d0c7] sm:text-[16.5px] sm:leading-7">
                  Meetings, seminars, lectures: in the room or from a call tab. JotBox keeps the words, the Pidgin, and
                  the tone, then writes the summary, decisions, and next steps. You stay present.
                </p>
                <div className="mt-7 flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                  <Link to={startHref} className="btn btn-lg btn-cream w-full sm:w-auto">
                    <Mic className="h-4 w-4" />
                    Start a capture
                  </Link>
                  <Link to={appHref} className="btn btn-lg btn-hero-line w-full sm:w-auto">
                    <Cloud className="h-4 w-4" />
                    {signedIn ? "Open your notes" : "Keep notes across devices"}
                  </Link>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-[#a6b5a8]">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Recordings stay on your device
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    Free to start
                  </span>
                </div>
              </div>

              <div className="relative lg:pl-2">
                <div className="float-soft">
                  <LivePidginCard />
                </div>
              </div>
            </div>
          </div>
          <div className="relative h-14 w-full bg-gradient-to-b from-transparent via-paper/55 to-paper sm:h-20" aria-hidden />
        </section>

        <div className="mx-auto mt-4 max-w-[1320px] px-4 sm:px-6 lg:px-8">
          <div className="marquee py-3">
            <div className="marquee-track items-center text-[12px] font-medium uppercase tracking-[0.14em] text-faint">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex items-center gap-6 pr-6" aria-hidden={copy === 1}>
                  {MARQUEE.map((item) => (
                    <span key={item} className="flex items-center gap-6 whitespace-nowrap">
                      {item}
                      <span className="h-1 w-1 rounded-full bg-line-strong" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <section id="how" className="mx-auto mt-16 max-w-[1320px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
            <Reveal>
              <div>
                <p className="kicker">How it works</p>
                <h2 className="mt-2 max-w-[14ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[40px]">
                  Three steps. No typing required.
                </h2>
                <p className="mt-3 max-w-[34ch] text-[15px] leading-6 text-muted">
                  JotBox is built around the way a session actually happens: someone talks, you listen, and the useful
                  parts need to survive the room.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="chip">
                    <Mic className="h-3 w-3" />
                    One tap to start
                  </span>
                  <span className="chip">
                    <Lock className="h-3 w-3" />
                    Private recordings
                  </span>
                </div>
              </div>
            </Reveal>
            <div className="space-y-3">
              {STEPS.map((step, index) => (
                <Reveal key={step.title} delay={index * 90}>
                  <div className="card card-lift flex gap-4 p-4 sm:p-5">
                    <div className="flex flex-col items-center gap-2">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-soft text-[13px] font-semibold text-accent">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {index < STEPS.length - 1 && <span className="w-px flex-1 bg-line" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <step.Icon className="h-4 w-4 text-brass" strokeWidth={1.8} />
                        <h3 className="text-[16px] font-semibold tracking-[-0.015em] text-ink">{step.title}</h3>
                      </div>
                      <p className="mt-1.5 text-[14.5px] leading-6 text-muted">{step.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="pidgin" className="mx-auto mt-16 max-w-[1320px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-14">
            <Reveal>
              <div>
                <p className="kicker">Pidgin &amp; tone</p>
                <h2 className="mt-2 max-w-[16ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[40px]">
                  It hears the room the way the room sounds.
                </h2>
                <p className="mt-3 max-w-[36ch] text-[15px] leading-6 text-muted">
                  Nigerian Pidgin is not broken English. JotBox keeps “wetin dey happen” as it was said, then writes
                  notes you can send in clear English, with the lines that carry the tone kept in quotes.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    "Pidgin, English, Yoruba, Igbo, and Hausa are all welcome in the same sentence.",
                    "No translating the room into corporate English.",
                    "Names, amounts, dates, and decisions stay exact.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[14px] leading-5 text-soft">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.4} />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {["wetin dey happen", "no wahala", "make we", "e go", "abeg", "sha"].map((phrase) => (
                    <span key={phrase} className="chip !text-[12px] italic">
                      “{phrase}”
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>

            <div className="grid gap-3 sm:grid-cols-2">
              <Reveal delay={60} className="h-full">
                <div className="card h-full p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.13em] text-faint">What was said</p>
                    <span className="chip !min-h-0 !px-2 !py-0.5 !text-[11px]">
                      <span className="live-dot !h-1 !w-1" />
                      Live
                    </span>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {LIVE_LINES.slice(0, 3).map((line) => (
                      <p key={line.text} className="text-[13.5px] leading-5 text-muted">
                        <span className="font-semibold text-brass">{line.who}</span>
                        <span className="mx-1.5 text-faint">·</span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                  <div className="mt-3 border-t border-line pt-2.5">
                    <StaticBars className="h-5 w-24 text-accent" heights={[0.3, 0.6, 0.9, 0.45, 0.75, 1, 0.5, 0.3]} />
                  </div>
                </div>
              </Reveal>

              <Reveal delay={140} className="h-full">
                <div className="card h-full border-accent/40 p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.13em] text-faint">What you get</p>
                    <span className="chip !min-h-0 border-transparent !bg-accent-soft !px-2 !py-0.5 !text-[11px] !text-accent">
                      <Sparkles className="h-2.5 w-2.5" />
                      Notes
                    </span>
                  </div>
                  <p className="mt-3 text-[14.5px] font-semibold tracking-[-0.01em] text-ink">Friday payout review</p>
                  <p className="mt-1.5 text-[13.5px] leading-5 text-muted">
                    Friday’s payout is still partly unsettled because the bank acknowledged the file late. The team
                    agreed: <em className="text-soft">“make we pause the same-day promise”</em> until the cutoff holds.
                  </p>
                  <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.13em] text-faint">Next steps</p>
                  <div className="mt-1.5 space-y-1.5">
                    {["Send the merchant note before 4pm", "Re-pull the two failed batches"].map((item) => (
                      <p key={item} className="flex items-start gap-1.5 text-[13px] leading-5 text-soft">
                        <Check className="mt-0.5 h-3 w-3 flex-none text-accent" strokeWidth={2.6} />
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section id="result" className="mx-auto mt-16 max-w-[1320px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="kicker">The written result</p>
                <h2 className="mt-2 max-w-[20ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[40px]">
                  A page you would have written if you could type while listening.
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link to={exampleHref} className="btn btn-line btn-sm">
                  See an example
                </Link>
                <Link to={appHref} className="btn btn-line btn-sm">
                  Open JotBox
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="card mt-6 overflow-hidden">
              <ChromeBar label="jotbox / notes / payout-review" />
              <img
                src="/landing-notes.png"
                alt="JotBox notes document with summary, key points, action items, and the spoken words alongside"
                className="hidden aspect-[16/10] w-full object-cover object-top md:block"
                loading="lazy"
              />
              <div className="flex justify-center bg-raised-2 px-4 py-8 md:hidden">
                <img
                  src="/landing-studio.png"
                  alt="JotBox live session on a phone"
                  className="w-[300px] rounded-[1.4rem] border border-line shadow-float"
                  loading="lazy"
                />
              </div>
            </div>
          </Reveal>
        </section>

        <section id="memory" className="mx-auto mt-16 max-w-[1320px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:gap-14">
            <Reveal>
              <div>
                <p className="kicker">Organisational memory</p>
                <h2 className="mt-2 max-w-[17ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[40px]">
                  Notes end when the meeting ends. The memory doesn’t.
                </h2>
                <p className="mt-3 max-w-[38ch] text-[15px] leading-6 text-muted">
                  Ask across months of meetings. JotBox puts the decision history back together (what was planned, what
                  changed, and why) and points every recorded fact at the meeting it came from.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    "Recorded decisions are cited. If no reason was written down, JotBox says so instead of inventing one.",
                    "Private, confidential, and other departments’ meetings never reach the answer.",
                    "Departments, roles, sharing, and an audit trail keep the history honest.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[14px] leading-5 text-soft">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.4} />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Link to={memoryHref} className="btn btn-primary btn-sm">
                    Open the memory
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <span className="chip">
                    <Building2 className="h-3 w-3" />
                    Departments &amp; roles
                  </span>
                  <span className="chip">
                    <ShieldCheck className="h-3 w-3" />
                    Audit trail
                  </span>
                </div>
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="card overflow-hidden">
                <ChromeBar label="jotbox / memory" />
                <div className="p-4 sm:p-5">
                  <div className="flex items-start gap-2.5">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
                      <BrainCircuit className="h-4 w-4" />
                    </span>
                    <p className="rounded-xl rounded-tl-sm border border-line bg-raised-2 px-3 py-2 text-[13.5px] leading-5 text-soft">
                      What was our original expansion plan, what changed, and why?
                    </p>
                  </div>

                  <p className="mt-3 text-[13.5px] leading-5 text-muted">
                    The record shows a plan for two hubs, a budget shift in February, and a pause in April. No meeting
                    records the reason for the change.
                  </p>

                  <div className="mt-3 space-y-2 border-l border-line pl-3.5">
                    {[
                      { date: "January", text: "Two hubs: Ibadan and Abuja by March." },
                      { date: "February", text: "Abuja deposit moved to the second half." },
                      { date: "April", text: "Abuja paused; Ibadan build prioritised." },
                    ].map((item) => (
                      <div key={item.date} className="relative">
                        <span className="absolute -left-[1.12rem] top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{item.date}</p>
                        <p className="text-[13px] leading-5 text-soft">{item.text}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-line bg-raised p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Recorded</p>
                      <p className="mt-1 text-[12.5px] leading-4 text-soft">
                        “Abuja expansion paused” in the April strategy reset
                      </p>
                    </div>
                    <div className="rounded-lg border border-line bg-highlight p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">Not recorded</p>
                      <p className="mt-1 text-[12.5px] leading-4 text-soft">
                        No meeting states the reason, so none is invented.
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-faint">
                    <Lock className="h-3 w-3" />
                    Answers respect organisation, department, and meeting access.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-[1320px] px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 70}>
                <div className="card card-lift h-full p-4 sm:p-5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-raised-2 text-accent">
                    <feature.Icon className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <h3 className="mt-3 text-[15.5px] font-semibold tracking-[-0.015em] text-ink">{feature.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-5 text-muted">{feature.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="pricing" className="mx-auto mt-16 max-w-[1320px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <Reveal>
            <div className="mx-auto max-w-[620px] text-center">
              <p className="kicker">Pricing</p>
              <h2 className="mt-2 text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[40px]">
                Simple plans for every room.
              </h2>
              <p className="mt-3 text-[15px] leading-6 text-muted">
                Start free. Upgrade when JotBox becomes part of your week.
              </p>
            </div>
          </Reveal>

          <div className="mx-auto mt-9 grid max-w-[1200px] gap-4 lg:grid-cols-3 lg:items-stretch">
            <Reveal delay={40} className="h-full">
              <div className="card plan-card flex h-full flex-col p-6 sm:p-7">
                <p className="text-[15px] font-semibold text-ink">Free</p>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[42px] font-semibold leading-none tracking-[-0.05em] text-ink">$0</span>
                  <span className="text-[14px] text-muted">forever</span>
                </div>
                <p className="mt-2 text-[14px] leading-5 text-muted">For the occasional lecture or one good meeting.</p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {FREE_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[14px] leading-5 text-soft">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.4} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link to={signedIn ? "/listen" : startHref} className="btn btn-line mt-6 w-full">
                  {signedIn ? "Start listening" : "Start free"}
                </Link>
                <p className="mt-2.5 text-center text-[12px] text-faint">No card. No countdown.</p>
              </div>
            </Reveal>

            <Reveal delay={120} className="h-full">
              <div className="plan-popular h-full">
                <div className="card plan-card relative flex h-full flex-col border-accent p-6 sm:p-7">
                  <span className="absolute right-5 top-5 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-accent">
                    Most popular
                  </span>
                  <p className="text-[15px] font-semibold text-ink">Pro</p>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-[46px] font-semibold leading-none tracking-[-0.05em] text-ink">$7</span>
                    <span className="text-[14px] text-muted">/ month</span>
                  </div>
                  <p className="mt-2 text-[14px] leading-5 text-muted">For one person who listens for a living.</p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {PRO_FEATURES.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[14px] leading-5 text-soft">
                        <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.4} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link to={accountHref} className="btn btn-primary mt-6 w-full">
                    {signedIn ? "Manage your plan" : "Get Pro"}
                  </Link>
                  <p className="mt-2.5 text-center text-[12px] text-faint">Billed monthly. Cancel anytime.</p>
                </div>
              </div>
            </Reveal>

            <Reveal delay={200} className="h-full">
              <div className="card plan-card flex h-full flex-col p-6 sm:p-7">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-semibold text-ink">Enterprise</p>
                  <span className="chip !min-h-0 !px-2 !py-0.5 !text-[11px]">
                    <Building2 className="h-2.5 w-2.5" />
                    Teams
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[42px] font-semibold leading-none tracking-[-0.05em] text-ink">$12</span>
                  <span className="text-[14px] text-muted">/ seat / month</span>
                </div>
                <p className="mt-2 text-[14px] leading-5 text-muted">For teams, faculties, and firms with more rooms.</p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {TEAM_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[14px] leading-5 text-soft">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.4} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="mailto:hello@jotbox.app?subject=JotBox%20Enterprise"
                  className="btn btn-line mt-6 w-full"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Talk to us
                </a>
                <p className="mt-2.5 text-center text-[12px] text-faint">5 seats minimum. We help with rollout.</p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <p className="mt-5 text-center text-[12.5px] leading-5 text-faint">
              Prices in US dollars. Teams can pay yearly and save two months.
            </p>
          </Reveal>
        </section>

        <section id="privacy" className="mx-auto mt-16 max-w-[1320px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <Reveal>
            <div className="hero-ink relative overflow-hidden rounded-[1.5rem] p-6 sm:p-10">
              <div className="hero-grid pointer-events-none absolute inset-0" />
              <div className="relative grid gap-8 lg:grid-cols-[1fr_0.9fr]">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a6b5a8]">Privacy</p>
                  <h2 className="mt-2 max-w-[14ch] text-[32px] font-semibold leading-[1.08] tracking-[-0.045em] text-[#f5f1e4] sm:text-[40px]">
                    Your audio is not content.
                  </h2>
                  <p className="mt-3 max-w-[44ch] text-[14.5px] leading-6 text-[#c5d0c7]">
                    A meeting is not a dataset. JotBox keeps the recording on the device that made it, and only sends
                    the notes when you ask it to.
                  </p>
                  <Link to={accountHref} className="btn btn-hero-line btn-sm mt-5">
                    How accounts work
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="space-y-2.5">
                  {[
                    { Icon: Lock, text: "Recordings stay in this browser, not a JotBox library." },
                    { Icon: Cloud, text: "Notes and jottings follow you only after you sign in." },
                    { Icon: Sparkles, text: "Notes are written only when you ask for them." },
                    { Icon: MonitorUp, text: "No meeting bot. No calendar access. No tracking." },
                  ].map((item) => (
                    <div
                      key={item.text}
                      className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-3"
                    >
                      <item.Icon className="mt-0.5 h-3.5 w-3.5 flex-none text-[#dcc69b]" />
                      <p className="text-[13.5px] leading-5 text-[#d8e2d8]">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="mx-auto mt-16 max-w-[1320px] px-4 sm:mt-24 sm:px-6 lg:px-8">
          <Reveal>
            <div className="card relative overflow-hidden px-6 py-10 text-center sm:px-10 sm:py-14">
              <div className="pointer-events-none absolute -left-16 top-0 h-48 w-48 rounded-full bg-accent-soft blur-3xl" />
              <div className="pointer-events-none absolute -right-10 bottom-0 h-40 w-40 rounded-full bg-highlight blur-3xl" />
              <div className="relative">
                <span className="icon-float mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-accent text-accent-ink">
                  <BrandMark className="h-7 w-7 bg-transparent text-accent-ink shadow-none" />
                </span>
                <p className="kicker mt-5">Start with one room</p>
                <h2 className="mx-auto mt-2 max-w-[16ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.045em] text-ink sm:text-[44px]">
                  Bring the notes. Leave the typing.
                </h2>
                <p className="mx-auto mt-3 max-w-[42ch] text-[14.5px] leading-6 text-muted">
                  Capture a meeting, seminar, or lecture today. Sign in once and your notes follow you.
                </p>
                <div className="mt-6 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row">
                  <Link to={startHref} className="btn btn-primary btn-lg">
                    <Mic className="h-4 w-4" />
                    Start a capture
                  </Link>
                  <Link to={appHref} className="btn btn-line btn-lg">
                    <Cloud className="h-4 w-4" />
                    {signedIn ? "Open your notes" : "Create a free account"}
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="mx-auto mt-16 max-w-[1320px] border-t border-line px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Brand />
          <p className="text-[12.5px] text-faint">Notes for the room and the call. Built for the way we meet.</p>
          <div className="flex items-center gap-4 text-[13px] font-medium text-muted">
            <a href="#how" className="transition-colors hover:text-ink">
              How it works
            </a>
            <a href="#pricing" className="transition-colors hover:text-ink">
              Pricing
            </a>
            <Link to={signedIn ? "/app" : authHref} className="transition-colors hover:text-ink">
              {signedIn ? "Open JotBox" : "Sign in"}
            </Link>
            <a href="https://github.com/luisjjj/Jotbox" className="transition-colors hover:text-ink">
              GitHub
            </a>
          </div>
        </div>
        <p className="mt-5 text-[12px] text-faint">
          © {new Date().getFullYear()} JotBox. Recordings stay on your device. Notes follow you only when you sign in.
        </p>
      </footer>
    </div>
  );
}
