import type { Session } from "./types";
import { sessionSlug } from "./exportNotes";

export async function downloadSessionPdf(session: Session) {
  const [{ pdf }, { SessionDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/pdf/SessionDocument"),
  ]);
  const blob = await pdf(<SessionDocument session={session} />).toBlob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sessionSlug(session)}-jotbox.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
