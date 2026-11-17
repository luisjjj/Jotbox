import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { BrandMark } from "@/components/Brand";

export default function ReferralRedirect() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    const slug = code.trim().toLowerCase();
    const target = user ? "/app" : `/?ref=${encodeURIComponent(slug)}`;
    let alive = true;

    fetch(`/r/${encodeURIComponent(slug)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .catch(() => null)
      .finally(() => {
        if (alive) navigate(target, { replace: true });
      });

    return () => {
      alive = false;
    };
  }, [code, loading, navigate, user]);

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="flex flex-col items-center gap-4">
        <BrandMark className="h-12 w-12 rounded-2xl" />
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    </div>
  );
}
