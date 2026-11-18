import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Loader2, Plus, UserRound, Users, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { api } from "@/lib/api";
import { useSessions } from "@/lib/store";
import {
  keepMatches,
  renameSpeaker,
  renameSpeakerInNotes,
  speakerLabels,
  unlabeledSpeakers,
  type SpeakerMatch,
} from "@/lib/speakers";
import type { Session } from "@/lib/types";

export function PeopleCard({ session }: { session: Session }) {
  const patch = useSessions((state) => state.patch);
  const [name, setName] = useState("");
  const [suggestions, setSuggestions] = useState<SpeakerMatch[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const ticketRef = useRef(0);
  const autoRanRef = useRef("");
  const participants = session.participants ?? [];
  const speakers = speakerLabels(session.transcript);
  const generic = unlabeledSpeakers(session.transcript);
  const lineCounts = new Map<string, number>();
  for (const line of session.transcript ?? []) {
    if (line.speaker) lineCounts.set(line.speaker, (lineCounts.get(line.speaker) ?? 0) + 1);
  }

  const add = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (participants.some((person) => person.name.toLowerCase() === clean.toLowerCase())) {
      toast.error("That person is already on the list.");
      return;
    }
    patch(session.id, {
      participants: [...participants, { id: crypto.randomUUID(), name: clean }],
    });
    setName("");
  };

  const toggleGuest = (id: string) => {
    patch(session.id, {
      participants: participants.map((person) =>
        person.id === id ? { ...person, external: !person.external } : person,
      ),
    });
  };

  const remove = (id: string) => {
    patch(session.id, { participants: participants.filter((person) => person.id !== id) });
  };

  const rename = (from: string, value: string) => {
    const to = value.trim();
    if (!to || to === from) return;
    patch(session.id, {
      transcript: renameSpeaker(session.transcript, from, to),
      notes: renameSpeakerInNotes(session.notes, from, to),
    });
    setSuggestions((current) => current.filter((item) => item.speaker !== from));
  };

  const findNames = async () => {
    if (!generic.length || !participants.length) return;
    const ticket = ++ticketRef.current;
    setSuggesting(true);
    try {
      const result = await api.suggestSpeakers({
        title: session.title,
        kind: session.kind,
        participants: participants.map((person) => person.name),
        transcript: session.transcript,
      });
      if (ticket !== ticketRef.current) return;
      setSuggestions(keepMatches(session.transcript, participants, result.matches));
      setDismissed(new Set());
    } catch {
      // The manual naming below stays available when the reading fails.
    } finally {
      if (ticket === ticketRef.current) setSuggesting(false);
    }
  };

  const autoKey = `${session.id}:${session.transcript.length}:${participants.map((person) => person.name).join("|")}`;
  useEffect(() => {
    if (session.status !== "ready" || !generic.length || !participants.length) return;
    if (autoRanRef.current === autoKey) return;
    autoRanRef.current = autoKey;
    void findNames();
    // The run is keyed to the session and roster, so it does not repeat on reuse.
  }, [autoKey, session.status, generic.length, participants.length]);

  const dismiss = (speaker: string) => {
    setDismissed((current) => new Set(current).add(speaker));
  };

  return (
    <section className="card-quiet mt-3 p-3.5" aria-label="People">
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-muted" />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">People</h2>
      </div>

      {participants.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {participants.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5"
            >
              <UserRound className="h-3.5 w-3.5 flex-none text-faint" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-soft">{person.name}</span>
              <button
                type="button"
                className={clsx(
                  "chip py-0.5 text-[11px]",
                  person.external && "border-accent bg-accent-soft text-accent",
                )}
                onClick={() => toggleGuest(person.id)}
                title="Mark this person as a guest"
              >
                {person.external ? "Guest" : "In room"}
              </button>
              <button
                type="button"
                className="icon-btn h-6 w-6 text-faint hover:text-rec"
                onClick={() => remove(person.id)}
                aria-label={`Remove ${person.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="mt-2 flex items-center gap-1.5" onSubmit={add}>
        <input
          className="field h-8 min-w-0 flex-1 text-[13px]"
          placeholder="Add a person"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          aria-label="Add a person to this session"
        />
        <button
          type="submit"
          className="icon-btn h-8 w-8 flex-none border border-line"
          disabled={!name.trim()}
          aria-label="Add person"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>

      {speakers.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">Speaker names</p>
            {generic.length > 0 && participants.length > 0 && (
              <span className="flex-none text-[11px] text-faint">
                {suggesting ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Reading who spoke
                  </span>
                ) : (
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2 hover:text-ink"
                    onClick={() => void findNames()}
                  >
                    Find names
                  </button>
                )}
              </span>
            )}
          </div>
          <ul className="mt-1.5 space-y-2">
            {speakers.map((speaker) => {
              const suggestion = suggestions.find(
                (item) => item.speaker === speaker && !dismissed.has(speaker),
              );
              return (
                <li key={speaker} className="rounded-lg border border-line bg-raised px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-soft">{speaker}</span>
                    <span className="flex-none text-[11.5px] text-faint">
                      {lineCounts.get(speaker) ?? 0} lines
                    </span>
                  </div>
                  {suggestion && (
                    <div className="mt-1.5 rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5">
                      <p className="text-[12px] leading-4 text-soft">
                        {suggestion.confidence === "high" ? "Sounds like" : "Could be"}{" "}
                        <span className="font-semibold text-accent">{suggestion.name}</span>
                      </p>
                      {suggestion.quote && (
                        <p className="mt-0.5 text-[11.5px] leading-4 text-faint">"{suggestion.quote}"</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="chip border-accent bg-accent py-0.5 text-[11px] text-accent-ink"
                          onClick={() => rename(speaker, suggestion.name)}
                        >
                          Yes, {suggestion.name}
                        </button>
                        <button
                          type="button"
                          className="chip py-0.5 text-[11px]"
                          onClick={() => dismiss(speaker)}
                        >
                          Not them
                        </button>
                      </div>
                    </div>
                  )}
                  {participants.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {participants.map((person) => (
                        <button
                          key={person.id}
                          type="button"
                          className={clsx(
                            "chip py-0.5 text-[11px]",
                            speaker === person.name && "border-accent bg-accent-soft text-accent",
                          )}
                          onClick={() => rename(speaker, person.name)}
                          title={`Name ${speaker} as ${person.name}`}
                        >
                          {person.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    key={`${speaker}-name`}
                    className="field mt-1.5 h-8 w-full text-[13px]"
                    defaultValue={/^Speaker \d+$/.test(speaker) ? "" : speaker}
                    placeholder="Or type a name"
                    onBlur={(event) => rename(speaker, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    aria-label={`Rename ${speaker}`}
                    maxLength={80}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[12px] leading-4 text-faint">
            Speakers are split from the audio. JotBox reads the words to suggest names, and every line and the
            notes follow once you pick one.
          </p>
        </div>
      )}

      {participants.length === 0 && speakers.length > 0 && (
        <p className="mt-1.5 text-[12px] leading-4 text-faint">
          Add the people who spoke above, then tap a name to label each speaker.
        </p>
      )}

      {participants.length === 0 && speakers.length === 0 && (
        <p className="mt-2 text-[12.5px] leading-4 text-faint">
          Add who is in the room, so the notes can name people instead of "Unassigned".
        </p>
      )}
    </section>
  );
}
