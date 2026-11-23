import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AUTH_EXPIRED_EVENT, api, type CloudUser } from "@/lib/api";
import type { DashboardRole } from "@/lib/roles";
import { cloudSuspended, flushCloudSessions, setCloudSuspended } from "@/lib/cloud";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { useUsage } from "@/lib/usageStore";
import posthog, { posthogEnabled } from "@/lib/posthog";

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
  const identifiedUserId = useRef<string | null>(null);

  const resetPostHog = useCallback(() => {
    if (!posthogEnabled) return;
    posthog.reset();
    identifiedUserId.current = null;
  }, []);

  useEffect(() => {
    if (!user || !posthogEnabled || identifiedUserId.current === user.id) return;

    posthog.identify(user.id, {
      $email: user.email,
      $name: user.name,
      ...(user.role ? { role: user.role } : {}),
    });
    identifiedUserId.current = user.id;
    posthog.logger.info("authenticated_session_ready", {
      role_configured: Boolean(user.role),
    });
  }, [user]);

  useEffect(() => {
    let alive = true;
    void api
      .me()
      .then((result) => {
        if (!alive) return;
        setCloudSuspended(false);
        if (!result.user) resetPostHog();
        setUser(result.user);
        if (posthogEnabled) {
          posthog.logger.info("auth_session_bootstrapped", {
            authenticated: Boolean(result.user),
          });
        }
      })
      .catch(() => {
        if (!alive) return;
        resetPostHog();
        setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [resetPostHog]);

  useEffect(() => {
    const onExpired = () => {
      resetPostHog();
      setCloudSuspended(true);
      setUser(null);
      useSync.getState().reset();
      useUsage.getState().reset();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [resetPostHog]);

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
    if (posthogEnabled) posthog.logger.info("auth_sign_out_completed");
    resetPostHog();
    setUser(null);
    if (!preserve && !failed.length && !failedDeletes) useSessions.getState().clear();
    useSync.getState().reset();
    useUsage.getState().reset();
  }, [resetPostHog]);

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
