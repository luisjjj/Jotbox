import { useEffect, useState } from "react";
import { Copy, Loader2, Mail, MessageSquare, Send, Wand2 } from "lucide-react";
import clsx from "clsx";
import { toast } from "react-hot-toast";
import { Modal } from "./Modal";
import { PaywallDialog } from "./Paywall";
import {
  CHANNEL_LABEL,
  LANGUAGE_LABEL,
  draftFollowUp,
  localFollowUp,
  type FollowUpChannel,
  type FollowUpLanguage,
} from "@/lib/followUp";
import { ApiError } from "@/lib/api";
import { usePro } from "@/lib/usageStore";
import type { Session } from "@/lib/types";

const CHANNELS: FollowUpChannel[] = ["whatsapp", "email", "recap"];
const LANGUAGES: FollowUpLanguage[] = ["english", "pidgin"];

export function FollowUpDialog({
  session,
  open,
  onClose,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<FollowUpChannel>("whatsapp");
  const [language, setLanguage] = useState<FollowUpLanguage>("english");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const pro = usePro();

  useEffect(() => {
    if (!open) return;
    setText(localFollowUp(session, channel, language).text);
  }, [open, session, channel, language]);

  const draft = async () => {
    if (!pro) {
      setPaywall(true);
      return;
    }
    setBusy(true);
    try {
      const result = await draftFollowUp({ session, channel, language });
      setText(result.text);
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) {
        setPaywall(true);
      } else {
        toast.error("JotBox could not write that just now. The draft from your notes is still here.");
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Draft copied");
    } catch {
      toast.error("Copy failed. Select the text and copy it.");
    }
  };

  const send = () => {
    if (!text.trim()) return;
    if (channel === "email") {
      const subject = encodeURIComponent(`${session.title}: recap`);
      window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(text)}`;
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="Send the follow-up"
      description="A short recap you can put in the group chat or an email. You can edit it before it goes."
      wide
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="seg">
            {CHANNELS.map((item) => (
              <button
                key={item}
                type="button"
                className="seg-item"
                data-active={channel === item}
                onClick={() => setChannel(item)}
              >
                {CHANNEL_LABEL[item]}
              </button>
            ))}
          </div>
          <div className="seg">
            {LANGUAGES.map((item) => (
              <button
                key={item}
                type="button"
                className="seg-item"
                data-active={language === item}
                onClick={() => setLanguage(item)}
              >
                {LANGUAGE_LABEL[item]}
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="field min-h-[240px] resize-y text-[14.5px] leading-6"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Follow-up draft"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="btn btn-line btn-sm"
            onClick={() => void draft()}
            disabled={busy}
            title={pro ? "Write a fresh draft with JotBox" : "AI drafting is part of Pro"}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Write with JotBox
            {!pro && <span className="chip !min-h-0 !px-1.5 !py-0 text-[10.5px] uppercase tracking-[0.08em]">Pro</span>}
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={clsx("btn btn-line btn-sm", !text.trim() && "opacity-50")}
              onClick={() => void copy()}
              disabled={!text.trim()}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={send}
              disabled={!text.trim()}
            >
              {channel === "email" ? <Mail className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              {channel === "email" ? "Open email" : channel === "whatsapp" ? "Open WhatsApp" : "Share recap"}
            </button>
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-[12.5px] leading-5 text-faint">
          <MessageSquare className="mt-0.5 h-3 w-3 flex-none" />
          {pro
            ? "JotBox only draws from this session. Check names and dates before you send it to anyone outside the room."
            : "The draft from your notes is free to edit and send. Pro lets JotBox write a fresh one."}
        </p>
      </div>
    </Modal>
    <PaywallDialog
      open={paywall}
      onClose={() => setPaywall(false)}
      title="AI follow-up drafts are part of Pro"
      description="The draft built from your notes stays free. Pro lets JotBox rewrite it for WhatsApp, email or a plain recap."
    />
    </>
  );
}
