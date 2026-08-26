/**
 * Thin fetch wrapper. Token source depends on the host mode: the dashboard SPA
 * keeps its JWT in localStorage as `empire_token` (same origin, so we can read
 * it), standalone stores `mp_token`. Cookies are sent as well, so either works.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function readToken(): string | null {
  try {
    return localStorage.getItem("mp_token") ?? localStorage.getItem("empire_token");
  } catch { return null; }
}

export function storeStandaloneToken(token: string | null): void {
  try {
    if (token) localStorage.setItem("mp_token", token); else localStorage.removeItem("mp_token");
  } catch { /* storage unavailable */ }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = readToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const { json, headers: extraHeaders, ...rest } = init;
  let body: BodyInit | null = null;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  const res = await fetch(`/api/mp${path}`, { ...rest, headers: { ...headers, ...(extraHeaders as Record<string, string> | undefined) }, body, credentials: "same-origin" });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail ?? `Fehler ${res.status}`;
    throw new ApiError(res.status, detail);
  }
  return data as T;
}
