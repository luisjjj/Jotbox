import { useEffect } from "react";
import {
  ArrowRight,
  AudioLines,
  Check,
  Cloud,
  Layers,
  Lock,
  Mic,
  MonitorUp,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Brand, BrandMark } from "@/components/Brand";
import { NotePreview } from "@/components/NotePreview";

function ChromeBar({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-line bg-raised-2 px-4 py-2.5">
      <span className="h-2 w-2 rounded-full bg-[#e5a09a]" />
      <span className="h-2 w-2 rounded-full bg-[#e7cf9e]" />
      <span className="h-2 w-2 rounded-full bg-[#a9c9ae]" />
      <span className="ml-2 rounded-md border border-line bg-raised px-2 py-0.5 text-[9px] text-faint">{label}</span>
    </div>
  );
}

const STEPS = [
  {
    Icon: Mic,
    title: "Start listening",
    body: "Use the microphone in the room, or share a Meet, Zoom, or Teams tab and tick the audio box. JotBox captures the audio and the live transcript.",
  },
  {
    Icon: Sparkles,
    title: "Jot the few lines that matter",
    body: "A decision, a name, a number, something you owe someone. Short lines become the spine of the written notes. Typing is optional.",
  },
  {
    Icon: AudioLines,
    title: "Stop and read",
    body: "JotBox writes the summary, key points, actions, and sections. Keep it on the device, or sign in to open it on your phone or laptop.",
  },
];

const FEATURES = [
  {
    Icon: Mic,
    title: "Room or call",
    body: "Microphone for lectures and meetings. Tab audio plus your mic for calls. Upload a recording if you already have one.",
  },
  {
    Icon: AudioLines,
    title: "Two panes",
    body: "Your jottings on one side, the live transcript on the other. On a phone they become simple tabs.",
  },
  {
    Icon: Layers,
    title: "Floats above",
    body: "Pin the compact window over your slides, editor, or call on desktop Chrome and Edge. Keep working.",
  },
  {
    Icon: ShieldCheck,
    title: "Private by default",
    body: "Audio stays on the device. Notes and transcripts sync only when you choose to sign in.",
  },
];

export default function Landing() {
  const { user } = useAuth();

  useEffect(() => {
    document.title = "JotBox — the notes are written while you listen";
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-paper backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          <nav className="hidden items-center gap-6 text-[12px] font-medium text-muted md:flex">
            <a href="#how" className="transition-colors hover:text-ink">
              How it works
            </a>
            <a href="#result" className="transition-colors hover:text-ink">
              The notes
            </a>
            <a href="#privacy" className="transition-colors hover:text-ink">
              Privacy
            </a>
          </nav>
          <div className="flex items-center gap-1.5">
            {!user && (
              <Link to="/account" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                Sign in
              </Link>
            )}
            <Link to="/app" className="btn btn-primary btn-sm">
              {user ? "Open JotBox" : "Try JotBox"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[1180px] px-4 pt-5 sm:px-6 sm:pt-8 lg:px-8">
          <div className="hero-ink relative overflow-hidden rounded-[1.5rem] shadow-float">
            <div className="hero-grid pointer-events-none absolute inset-0" />
            <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.08fr_0.92fr] lg:p-12">
              <div className="flex flex-col items-start">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e7e2d3]">
                  <span className="live-dot" />
                  Live capture
                </span>
                <h1 className="mt-5 max-w-[18ch] font-serif text-[2.6rem] leading-[1.02] tracking-[-0.005em] text-[#f5f1e4] sm:text-[3.5rem]">
                  The notes are written <em className="italic text-[#dcc69b]">while you listen.</em>
                </h1>
                <p className="mt-4 max-w-[42ch] text-[13.5px] leading-6 text-[#c5d0c7] sm:text-[14.5px] sm:leading-7">
                  Meetings, seminars, lectures — in the room or from a call tab. JotBox keeps the transcript, then
                  writes the summary, decisions, and next steps. You stay present.
                </p>
                <div className="mt-7 flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                  <Link to="/listen" className="btn btn-lg btn-cream w-full sm:w-auto">
                    <Mic className="h-4 w-4" />
                    Start a capture
                  </Link>
                  <Link to={user ? "/app" : "/account"} className="btn btn-lg btn-hero-line w-full sm:w-auto">
                    <Cloud className="h-4 w-4" />
                    {user ? "Open your notes" : "Sync across devices"}
                  </Link>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-[#a6b5a8]">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Audio stays on this device
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    No account needed to try it
                  </span>
                </div>
              </div>

              <div className="relative hidden min-h-[300px] lg:block">
                <NotePreview />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">
            <span>Meetings · Seminars · Lectures · Voice notes</span>
            <span className="normal-case tracking-normal">Built for the phone in your pocket</span>
          </div>
        </section>

        <section id="how" className="mx-auto mt-16 max-w-[1180px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
            <div>
              <p className="kicker">How it works</p>
              <h2 className="mt-2 max-w-[14ch] font-serif text-[30px] leading-[1.1] text-ink sm:text-[38px]">
                Three steps. No typing required.
              </h2>
              <p className="mt-3 max-w-[34ch] text-[13px] leading-6 text-muted">
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
                  Local audio
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {STEPS.map((step, index) => (
                <div key={step.title} className="card flex gap-4 p-4 sm:p-5">
                  <div className="flex flex-col items-center gap-2">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-soft text-[11px] font-semibold text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {index < STEPS.length - 1 && <span className="w-px flex-1 bg-line" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <step.Icon className="h-4 w-4 text-brass" strokeWidth={1.8} />
                      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{step.title}</h3>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-6 text-muted">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="result" className="mx-auto mt-16 max-w-[1180px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="kicker">The written result</p>
              <h2 className="mt-2 max-w-[20ch] font-serif text-[30px] leading-[1.1] text-ink sm:text-[38px]">
                A page you would have written if you could type while listening.
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/app?demo=1" className="btn btn-line btn-sm">
                See an example
              </Link>
              <Link to="/app" className="btn btn-line btn-sm">
                Open JotBox
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="card mt-6 overflow-hidden">
            <ChromeBar label="jotbox / notes / payout-review" />
            <img
              src="/landing-notes.png"
              alt="JotBox notes document with summary, key points, action items, and a transcript panel"
              className="hidden aspect-[16/10] w-full object-cover object-top md:block"
              loading="lazy"
            />
            <div className="flex justify-center bg-raised-2 px-4 py-8 md:hidden">
              <img
                src="/landing-studio.png"
                alt="JotBox live studio on a phone"
                className="w-[300px] rounded-[1.4rem] border border-line shadow-float"
                loading="lazy"
              />
            </div>
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-[1180px] px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card p-4 sm:p-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-raised-2 text-accent">
                  <feature.Icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <h3 className="mt-3 text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{feature.title}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-muted">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="privacy" className="mx-auto mt-16 max-w-[1180px] scroll-mt-24 px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="hero-ink relative overflow-hidden rounded-[1.5rem] p-6 sm:p-10">
            <div className="hero-grid pointer-events-none absolute inset-0" />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_0.9fr]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6b5a8]">Privacy</p>
                <h2 className="mt-2 max-w-[14ch] font-serif text-[30px] leading-[1.08] text-[#f5f1e4] sm:text-[38px]">
                  Your audio is not content.
                </h2>
                <p className="mt-3 max-w-[44ch] text-[12.5px] leading-6 text-[#c5d0c7]">
                  A meeting is not a dataset. JotBox keeps the recording on the device that made it, and only syncs the
                  notes and transcript when you ask it to.
                </p>
                <Link to="/account" className="btn btn-hero-line btn-sm mt-5">
                  How accounts work
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="space-y-2.5">
                {[
                  { Icon: Lock, text: "Audio is stored in this browser, not a JotBox library." },
                  { Icon: Cloud, text: "Notes and transcripts sync only after you sign in." },
                  { Icon: Sparkles, text: "Studio transcription sends audio to the model provider for that session." },
                  { Icon: MonitorUp, text: "No meeting bot, no calendar access, no analytics." },
                ].map((item) => (
                  <div
                    key={item.text}
                    className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-3"
                  >
                    <item.Icon className="mt-0.5 h-3.5 w-3.5 flex-none text-[#dcc69b]" />
                    <p className="text-[11.5px] leading-5 text-[#d8e2d8]">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-[1180px] px-4 sm:mt-24 sm:px-6 lg:px-8">
          <div className="card relative overflow-hidden px-6 py-10 text-center sm:px-10 sm:py-14">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-accent text-accent-ink">
              <BrandMark className="h-7 w-7 bg-transparent text-accent-ink shadow-none" />
            </span>
            <p className="kicker mt-5">Start with one room</p>
            <h2 className="mx-auto mt-2 max-w-[16ch] font-serif text-[32px] leading-[1.08] text-ink sm:text-[42px]">
              Bring the notes. Leave the typing.
            </h2>
            <p className="mx-auto mt-3 max-w-[42ch] text-[12.5px] leading-6 text-muted">
              Capture a meeting, seminar, or lecture today. Sign in later if you want the notes to follow you.
            </p>
            <div className="mt-6 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row">
              <Link to="/listen" className="btn btn-primary btn-lg">
                <Mic className="h-4 w-4" />
                Start a capture
              </Link>
              <Link to="/account" className="btn btn-line btn-lg">
                <Cloud className="h-4 w-4" />
                Create a free account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-16 max-w-[1180px] border-t border-line px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Brand />
          <p className="text-[10.5px] text-faint">Notes for the room and the call. Built for the way we meet.</p>
          <div className="flex items-center gap-4 text-[11px] font-medium text-muted">
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <Link to="/account" className="hover:text-ink">
              Sign in
            </Link>
            <a href="https://github.com/luisjjj/Jotbox" className="hover:text-ink">
              GitHub
            </a>
          </div>
        </div>
        <p className="mt-5 text-[10px] text-faint">
          © {new Date().getFullYear()} JotBox. Audio stays on your device. Notes sync only when you sign in.
        </p>
      </footer>
    </div>
  );
}

