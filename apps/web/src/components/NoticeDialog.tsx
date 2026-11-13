import { Copy, Megaphone, Printer } from "lucide-react";
import { toast } from "react-hot-toast";
import { Modal } from "./Modal";
import {
  copyListeningNotice,
  noticeText,
  printListeningNotice,
  type NoticeInput,
} from "@/lib/listeningNotice";

export function NoticeDialog({
  input,
  open,
  onClose,
}: {
  input: NoticeInput;
  open: boolean;
  onClose: () => void;
}) {
  const text = noticeText(input);

  const copy = async () => {
    try {
      await copyListeningNotice(input);
      toast.success("Notice copied");
    } catch {
      toast.error("Copy failed. Select the text and copy it.");
    }
  };

  const print = () => {
    if (!printListeningNotice(input)) toast.error("Allow pop-ups to print the notice.");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tell the room"
      description="A short notice you can read out, paste in the chat, or print for the table."
      wide
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-line bg-highlight px-3.5 py-3 text-[13px] leading-5 text-soft">
          <Megaphone className="mt-0.5 h-4 w-4 flex-none text-brass" />
          <p>
            Read it before the session starts. People should know they are being recorded, and they should have a
            chance to say no.
          </p>
        </div>
        <pre className="scroll-quiet max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-raised-2 px-3.5 py-3 font-sans text-[14px] leading-6 text-soft">
          {text}
        </pre>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-line btn-sm" onClick={() => void copy()}>
            <Copy className="h-3.5 w-3.5" />
            Copy notice
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={print}>
            <Printer className="h-3.5 w-3.5" />
            Print notice
          </button>
        </div>
      </div>
    </Modal>
  );
}
