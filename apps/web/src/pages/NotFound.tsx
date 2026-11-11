import { Compass } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center pt-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-raised text-muted shadow-sm">
        <Compass className="h-5 w-5" />
      </span>
      <p className="kicker mt-5">404</p>
      <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.03em] text-ink">This page is not here.</h1>
      <p className="mt-2 text-[13px] leading-6 text-muted">
        The link may be old, or the session was deleted from this device.
      </p>
      <div className="mt-5 flex gap-2">
        <Link to="/app" className="btn btn-primary">
          Go home
        </Link>
        <Link to="/library" className="btn btn-line">
          Open the library
        </Link>
      </div>
    </div>
  );
}
