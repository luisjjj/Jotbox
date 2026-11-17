import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function RoleGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user && !user.role) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/welcome?next=${next}`} replace />;
  }

  return <>{children}</>;
}
