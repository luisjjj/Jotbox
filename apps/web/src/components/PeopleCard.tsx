import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { Plus, UserRound, Users, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { useSessions } from "@/lib/store";
import { renameSpeaker, speakerLabels } from "@/lib/speakers";
import type { Session } from "@/lib/types";

export function PeopleCard({ session }: { session: Session }) {
  const patch = useSessions((state) => state.patch);
  const [name, setName] = useState("");
  const participants = session.participants ?? [];
  const speakers = speakerLabels(session.transcript);

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
    patch(session.id, { transcript: renameSpeaker(session.transcript, from, to) });
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
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">Speaker names</p>
          <ul className="mt-1.5 space-y-1.5">
            {speakers.map((speaker) => (
              <li key={speaker} className="flex items-center gap-2">
                <span className="w-24 flex-none truncate text-[12.5px] text-faint">{speaker}</span>
                <input
                  className="field h-8 min-w-0 flex-1 text-[13px]"
                  defaultValue={speaker}
                  onBlur={(event) => rename(speaker, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label={`Rename ${speaker}`}
                  maxLength={80}
                />
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] leading-4 text-faint">
            Names are used across the notes. Rename once, and every line follows.
          </p>
        </div>
      )}

      {participants.length === 0 && speakers.length === 0 && (
        <p className="mt-2 text-[12.5px] leading-4 text-faint">
          Add who is in the room, so the notes can name people instead of "Unassigned".
        </p>
      )}
    </section>
  );
}
