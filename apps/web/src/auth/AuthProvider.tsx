import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AUTH_EXPIRED_EVENT, api, type CloudUser } from "@/lib/api";
import type { DashboardRole } from "@/lib/roles";
import { cloudSuspended, flushCloudSessions, setCloudSuspended } from "@/lib/cloud";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { useUsage } from "@/lib/usageStore";

interface AuthValue {
  user: CloudUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<CloudUser>;
  signUp: (name: string, email: string, password: string) => Promise<CloudUser>;
  updateRole: (role: DashboardRole) => Promise<CloudUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void api
      .me()
      .then((result) => {
        if (!alive) return;
        setCloudSuspended(false);
        setUser(result.user);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setCloudSuspended(true);
      setUser(null);
      useSync.getState().reset();
      useUsage.getState().reset();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.login({ email, password });
    setCloudSuspended(false);
    setUser(result.user);
    return result.user;
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const result = await api.register({ name, email, password });
    setCloudSuspended(false);
    setUser(result.user);
    return result.user;
  }, []);

  const updateRole = useCallback(async (role: DashboardRole) => {
    const result = await api.updateProfile(role);
    setUser(result.user);
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    // Notes that cannot reach the account stay on this device, scoped to this
    // user. A successful flush may clear the local cache; a failed one may not.
    const preserve = cloudSuspended();
    const { failed, failedDeletes } = preserve
      ? { failed: [], failedDeletes: 0 }
      : await flushCloudSessions();
    setCloudSuspended(true);
    try {
      await api.logout();
    } catch {
      // The local cache is kept or cleared below; the cookie expires server-side.
    }
    setUser(null);
    if (!preserve && !failed.length && !failedDeletes) useSessions.getState().clear();
    useSync.getState().reset();
    useUsage.getState().reset();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, signIn, signUp, updateRole, signOut }),
    [user, loading, signIn, signUp, updateRole, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
