import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type CloudUser } from "@/lib/api";
import { flushCloudSessions, setCloudSuspended } from "@/lib/cloud";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";

interface AuthValue {
  user: CloudUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<CloudUser>;
  signUp: (name: string, email: string, password: string) => Promise<CloudUser>;
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

  const signOut = useCallback(async () => {
    try {
      await flushCloudSessions();
    } catch {
      // Signing out must still work when the network is down. Unsent edits stay
      // in the local cache until the user signs in again.
    }
    setCloudSuspended(true);
    try {
      await api.logout();
    } catch {
      // The local cache is cleared regardless; the cookie expires server-side.
    }
    setUser(null);
    useSessions.getState().clear();
    useSync.getState().reset();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
