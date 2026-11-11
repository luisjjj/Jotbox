import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { BrandMark } from "@/components/Brand";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="h-11 w-11 rounded-2xl" />
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        </div>
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  return <>{children}</>;
}
