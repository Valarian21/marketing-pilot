/**
 * Dashboard host: trust the AI-Empire dashboard session.
 *
 * The dashboard signs HS256 JWTs (`sub` = username, 8 h) and mirrors them into
 * the httpOnly cookie `empire_session`; its SPA also keeps the token in
 * localStorage (`empire_token`) and sends it as Bearer. We accept both, using
 * the dashboard's own secret file - read only, never written. Tokens with
 * `typ: "ws"` belong to external Lehreule users and are rejected, mirroring the
 * dashboard's AuthMiddleware.
 */
import fs from "node:fs";
import path from "node:path";
import { jwtVerify } from "jose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Env } from "./server/env.js";
import { ROOT } from "./server/env.js";
import { bearerToken, type HostAdapter, type HostShell, type HostUser } from "./host-adapter.js";

export const DASHBOARD_COOKIE = "empire_session";
const DEFAULT_SECRET_FILE = path.resolve(ROOT, "../dashboard/data/jwt_secret.txt");

export function loadDashboardSecret(env: Env): Uint8Array {
  if (env.MP_HOST_JWT_SECRET) return new TextEncoder().encode(env.MP_HOST_JWT_SECRET);
  const file = env.MP_HOST_JWT_SECRET_FILE ?? DEFAULT_SECRET_FILE;
  if (!fs.existsSync(file)) {
    throw new Error(
      `Dashboard JWT secret not found at ${file}. Set MP_HOST_JWT_SECRET_FILE or MP_HOST_JWT_SECRET, ` +
      `or run with MP_STANDALONE=true.`,
    );
  }
  return new TextEncoder().encode(fs.readFileSync(file, "utf8").trim());
}

export class DashboardHostAdapter implements HostAdapter {
  readonly mode = "dashboard" as const;
  readonly publicPaths: readonly string[] = [];
  private readonly secret: Uint8Array;

  constructor(private readonly env: Env) {
    this.secret = loadDashboardSecret(env);
  }

  async authenticate(req: FastifyRequest): Promise<HostUser | null> {
    const token = bearerToken(req) ?? req.cookies[DASHBOARD_COOKIE] ?? null;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
      if (payload["typ"] === "ws") return null;
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      if (!sub) return null;
      return { id: sub, name: sub };
    } catch {
      return null;
    }
  }

  registerRoutes(_app: FastifyInstance): void {
    // The dashboard owns login/logout; nothing to add here.
  }

  shell(): HostShell {
    return { mode: "dashboard", backLink: this.env.MP_HOST_BACK_LINK, backLabel: "Zum Dashboard" };
  }
}
