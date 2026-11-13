import { useRef, useState, type FormEvent } from "react";
import { Loader2, MessageCircle, Send, Sparkles } from "lucide-react";
import clsx from "clsx";
import { OUTPUT_PRESETS } from "@/lib/presets";
import { askSession, type AskTurn } from "@/lib/sessionAsk";
import type { Session } from "@/lib/types";

export function SessionAsk({ session }: { session: Session }) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const preset = OUTPUT_PRESETS[session.kind];

  const ask = async (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const history = turns.slice(-6);
    setTurns((current) => [...current, { role: "user", content: clean }]);
    setQuestion("");
    setBusy(true);
    const result = await askSession({ question: clean, history, session });
    setTurns((current) => [...current, { role: "assistant", content: result.answer }]);
    setBusy(false);
    window.setTimeout(() => {
      const node = scroller.current;
      if (node) node.scrollTop = node.scrollHeight;
    }, 30);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <section className="card mt-5 overflow-hidden" aria-label="Ask this session">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-accent" />
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Ask this session</h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[12px] text-faint">
          <Sparkles className="h-3 w-3" />
          Only this capture
        </span>
      </div>

      {turns.length > 0 && (
        <div ref={scroller} className="scroll-quiet max-h-[260px] space-y-3 overflow-y-auto px-4 py-3.5">
          {turns.map((turn, index) => (
            <div
              key={`${turn.role}-${index}`}
              className={clsx("flex", turn.role === "user" ? "justify-end" : "justify-start")}
            >
              <p
                className={clsx(
                  "max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[14.5px] leading-6",
                  turn.role === "user"
                    ? "bg-accent text-accent-ink"
                    : "border border-line bg-raised-2 text-soft",
                )}
              >
                {turn.content}
              </p>
            </div>
          ))}
          {busy && (
            <p className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-raised-2 px-3 py-2 text-[13.5px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reading the session
            </p>
          )}
        </div>
      )}

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3.5">
          {preset.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="chip transition-colors hover:border-line-strong hover:text-ink"
              onClick={() => void ask(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form className="flex items-center gap-2 px-3 py-3" onSubmit={onSubmit}>
        <input
          className="field h-10 min-w-0 flex-1"
          placeholder="Ask about a person, decision, or number"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={400}
          aria-label="Ask a question about this session"
        />
        <button
          type="submit"
          className="btn btn-primary h-10 flex-none"
          disabled={busy || !question.trim()}
          aria-label="Send question"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Ask
        </button>
      </form>
    </section>
  );
}
