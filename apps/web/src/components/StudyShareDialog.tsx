import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, GraduationCap, Loader2, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { Modal } from "./Modal";
import { api, ApiError, type StudyGroup, type StudyQuota } from "@/lib/api";
import type { Session } from "@/lib/types";

/**
 * Share a finished capture into a study group from the session page.
 * A note is shared as it is; a quiz or deck is written first, which spends a
 * free generation on the free plan.
 */
export function StudyShareDialog({
  session,
  open,
  onClose,
  initialFormat = "note",
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
  initialFormat?: "note" | "quiz" | "cards";
}) {
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [quota, setQuota] = useState<StudyQuota | null>(null);
  const [groupId, setGroupId] = useState("");
  const [format, setFormat] = useState<"note" | "quiz" | "cards">(initialFormat);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paywalled, setPaywalled] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFormat(initialFormat);
    setLoading(true);
    setError("");
    setPaywalled(false);
    api
      .studyOverview()
      .then((data) => {
        if (!alive) return;
        setGroups(data.groups);
        setQuota(data.quota);
        setGroupId((current) =>
          current && data.groups.some((group) => group.id === current) ? current : data.groups[0]?.id ?? "",
        );
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof ApiError ? caught.message : "Could not load your study groups.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, initialFormat]);

  const share = async () => {
    if (!groupId) return;
    setBusy(true);
    setError("");
    setPaywalled(false);
    try {
      if (format === "note") {
        await api.shareStudyNote(groupId, session.id);
        toast.success("Note shared with the study group");
      } else {
        const result = await api.generateStudySet(groupId, session.id, format);
        setQuota(result.quota);
        toast.success(format === "quiz" ? "Quiz shared with the study group" : "Flashcards shared with the study group");
      }
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setPaywalled(true);
      } else {
        setError(caught instanceof ApiError ? caught.message : "That could not be shared.");
      }
    } finally {
      setBusy(false);
    }
  };

  const quotaLine =
    quota?.limit === null
      ? "Study sets are unlimited on your plan."
      : `${quota?.remaining ?? 3} of ${quota?.limit ?? 3} free study sets left this month.`;

  return (
    <Modal
      open={open}
      title="Share with a study group"
      description="Classmates get a snapshot. Your own note stays yours, and later edits do not reach them."
      onClose={onClose}
      wide
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[14px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your groups…
        </div>
      ) : groups.length === 0 ? (
        <div className="py-2">
          <p className="flex items-start gap-2 text-[14.5px] leading-6 text-muted">
            <GraduationCap className="mt-0.5 h-4 w-4 flex-none text-accent" />
            You are not in a study group yet. Make one for your class, or join with a code a classmate sent.
          </p>
          <Link to="/study" className="btn btn-primary mt-4" onClick={onClose}>
            Set up a study group
          </Link>
        </div>
      ) : (
        <>
          <p className="label">Group</p>
          <div className="mt-1.5 space-y-1.5">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setGroupId(group.id)}
                className={clsx(
                  "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                  groupId === group.id ? "border-accent bg-accent-soft" : "border-line bg-raised hover:border-line-strong",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium text-ink">{group.name}</span>
                  <span className="mt-0.5 block text-[12.5px] text-faint">
                    {group.memberCount} member{group.memberCount === 1 ? "" : "s"} · code {group.code}
                  </span>
                </span>
                {groupId === group.id && <Check className="h-4 w-4 flex-none text-accent" />}
              </button>
            ))}
          </div>

          <p className="label mt-4">What to share</p>
          <div className="seg mt-1.5 w-full">
            {(
              [
                { value: "note", label: "The note" },
                { value: "quiz", label: "A quiz" },
                { value: "cards", label: "Flashcards" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                className="seg-item flex-1 whitespace-nowrap text-[12.5px]"
                data-active={format === option.value}
                onClick={() => setFormat(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] leading-4 text-muted">
            {format === "note" ? "Sharing a note is free." : quotaLine}
          </p>

          {error && <p className="mt-3 text-[13.5px] leading-5 text-rec">{error}</p>}
          {paywalled && (
            <p className="mt-3 text-[13.5px] leading-5 text-soft">
              Free study sets are used up for this month.{" "}
              <Link to="/account" className="font-medium text-ink underline decoration-line-strong underline-offset-2" onClick={onClose}>
                Upgrade
              </Link>{" "}
              for unlimited quizzes and cards.
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-line" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !groupId} onClick={() => void share()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? "Working…" : format === "note" ? "Share note" : format === "quiz" ? "Make the quiz" : "Make the cards"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
