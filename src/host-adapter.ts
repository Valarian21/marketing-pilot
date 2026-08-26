/**
 * Host adapter - the only seam between Marketing Pilot and whatever hosts it.
 *
 * Everything the host provides (who is logged in, how to leave the module,
 * where data lives) goes through this interface. Two implementations exist:
 *
 *   host-adapter.dashboard.ts   - inside the AI-Empire dashboard (default)
 *   host-adapter.standalone.ts  - own login + own session (MP_STANDALONE=true)
 *
 * Nothing outside these three files may know which host is active.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "./server/env.js";

export interface HostUser {
  /** Stable identifier written into mp_audit_log. */
  id: string;
  /** Display name. */
  name: string;
}

export interface HostShell {
  mode: "dashboard" | "standalone";
  /** Link that leaves the module (dashboard home). null when there is none. */
  backLink: string | null;
  backLabel: string | null;
}

export interface HostAdapter {
  readonly mode: "dashboard" | "standalone";
  /** Resolve the current user from the request or return null (-> 401). */
  authenticate(req: FastifyRequest): Promise<HostUser | null>;
  /** Register host-specific routes (e.g. standalone login). Public paths must
   *  be listed in `publicPaths` so the auth hook lets them through. */
  registerRoutes(app: FastifyInstance): Promise<void> | void;
  readonly publicPaths: readonly string[];
  shell(): HostShell;
  /** Optional hook when a session is dropped (standalone clears its cookie). */
  logout?(reply: FastifyReply): void;
}

export async function createHostAdapter(env: Env): Promise<HostAdapter> {
  if (env.MP_STANDALONE) {
    const { StandaloneHostAdapter } = await import("./host-adapter.standalone.js");
    return new StandaloneHostAdapter(env);
  }
  const { DashboardHostAdapter } = await import("./host-adapter.dashboard.js");
  return new DashboardHostAdapter(env);
}

/** Extract a bearer token from the Authorization header, if present. */
export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h === "string" && h.startsWith("Bearer ") && h.length > 7) return h.slice(7);
  return null;
}
