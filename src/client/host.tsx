/** Host context: mode, current user and (standalone) login. Mirrors /api/mp/host. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { HostInfo } from "../shared/schemas.js";
import { api, storeStandaloneToken } from "./api.js";

interface HostState {
  info: HostInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (user: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const HostContext = createContext<HostState | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<HostInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await api<HostInfo>("/host"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Host nicht erreichbar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (user: string, password: string) => {
    const res = await api<{ token: string }>("/auth/login", { method: "POST", json: { user, password } });
    storeStandaloneToken(res.token);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* dashboard mode has no logout */ }
    storeStandaloneToken(null);
    await refresh();
  }, [refresh]);

  return <HostContext.Provider value={{ info, loading, error, refresh, login, logout }}>{children}</HostContext.Provider>;
}

export function useHost(): HostState {
  const ctx = useContext(HostContext);
  if (!ctx) throw new Error("useHost outside HostProvider");
  return ctx;
}
