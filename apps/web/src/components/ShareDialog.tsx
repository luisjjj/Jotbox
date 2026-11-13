import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Copy, Link2, Loader2, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Modal } from "./Modal";
import { PaywallDialog } from "./Paywall";
import { api, ApiError, type ShareLink } from "@/lib/api";
import { usePro } from "@/lib/usageStore";
import type { Session } from "@/lib/types";

export function ShareDialog({
  session,
  open,
  onClose,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
}) {
  const [days, setDays] = useState(7);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState(false);
  const pro = usePro();

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    setError("");
    setLoading(true);
    api
      .listShareLinks(session.id)
      .then(setLinks)
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not load links."))
      .finally(() => setLoading(false));
  }, [open, session.id]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const result = await api.createShareLink(session.id, pro ? days : 7);
      setCreated(`${window.location.origin}/s/${result.token}`);
      setLinks((current) => [result.link, ...current]);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setPaywall(true);
      } else {
        setError(caught instanceof ApiError ? caught.message : "The link could not be made.");
      }
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeShareLink(id);
      setLinks((current) =>
        current.map((link) => (link.id === id ? { ...link, revokedAt: Date.now() } : link)),
      );
      toast.success("Link turned off");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The link could not be turned off.");
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed. Select the link and copy it.");
    }
  };

  const guests = (session.participants ?? []).filter((person) => person.external);

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="Share these notes"
      description="A read-only page with the notes and spoken words. No audio, and no private jottings."
      wide
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised-2 px-3.5 py-3">
          <div>
            <p className="text-[14px] font-medium text-ink">Link expires after</p>
            <p className="mt-0.5 text-[12.5px] text-muted">You can turn it off sooner.</p>
          </div>
          <div className="seg">
            {[7, 30].map((value) => {
              const locked = value > 7 && !pro;
              return (
                <button
                  key={value}
                  type="button"
                  className="seg-item"
                  data-active={days === value}
                  onClick={() => {
                    if (locked) {
                      setPaywall(true);
                      return;
                    }
                    setDays(value);
                  }}
                >
                  {value} days
                  {locked && <Lock className="ml-1 inline h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>

        {!pro && (
          <p className="text-[12.5px] leading-4 text-faint">
            Free keeps one live link per session for 7 days. Pro gives you five links and lets them last 30 days.
          </p>
        )}

        {guests.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-line bg-highlight px-3.5 py-3 text-[13px] leading-5 text-soft">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-brass" />
            <p>
              {guests.map((person) => person.name).join(", ")}{" "}
              {guests.length === 1 ? "is marked as external." : "are marked as external."} Check that they should see
              this before you send the link.
            </p>
          </div>
        )}

        {error && <p className="text-[13.5px] leading-5 text-rec">{error}</p>}

        {created && (
          <div className="rounded-xl border border-accent bg-accent-soft p-3.5">
            <p className="text-[13.5px] font-medium text-ink">Your link is ready</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                className="field h-10 min-w-0 flex-1 font-mono text-[12.5px]"
                value={created}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Share link"
              />
              <button type="button" className="btn btn-primary btn-sm flex-none" onClick={() => void copy()}>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-faint">Live links</p>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" />}
          </div>
          {!loading && links.length === 0 && (
            <p className="mt-2 text-[13.5px] leading-5 text-muted">No links yet.</p>
          )}
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {links.map((link) => {
              const dead = Boolean(link.revokedAt) || (link.expiresAt ? link.expiresAt < Date.now() : false);
              return (
                <li key={link.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Link2 className="h-3.5 w-3.5 flex-none text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12.5px] text-soft">{link.hint}...</p>
                    <p className="text-[12px] text-faint">
                      {dead ? "Turned off" : "Active"} · {link.views} view{link.views === 1 ? "" : "s"}
                      {link.expiresAt ? ` · ends ${format(link.expiresAt, "d MMM")}` : ""}
                    </p>
                  </div>
                  {!dead && (
                    <button
                      type="button"
                      className="icon-btn h-7 w-7 text-faint hover:text-rec"
                      onClick={() => void revoke(link.id)}
                      aria-label="Turn off this link"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-line" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Make a link
          </button>
        </div>
      </div>
    </Modal>
    <PaywallDialog
      open={paywall}
      onClose={() => setPaywall(false)}
      title="More sharing is part of Pro"
      description="Free keeps one live link per session for 7 days. Pro gives you five links for up to 30 days."
    />
    </>
  );
}
