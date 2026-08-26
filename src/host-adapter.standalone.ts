/**
 * Standalone host: Marketing Pilot as its own app (MP_STANDALONE=true).
 *
 * Single admin login from env (MP_STANDALONE_USER / MP_STANDALONE_PASSWORD),
 * HS256 session token signed with MP_SESSION_SECRET (auto-generated into
 * MP_DATA_DIR/session_secret.txt when unset), delivered as httpOnly cookie
 * `mp_session` and as Bearer for API clients.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "./server/env.js";
import { bearerToken, type HostAdapter, type HostShell, type HostUser } from "./host-adapter.js";

export const STANDALONE_COOKIE = "mp_session";
const SESSION_HOURS = 12;

const LoginBody = z.object({ user: z.string().min(1), password: z.string().min(1) });

function loadOrCreateSecret(env: Env): Uint8Array {
  if (env.MP_SESSION_SECRET) return new TextEncoder().encode(env.MP_SESSION_SECRET);
  fs.mkdirSync(env.MP_DATA_DIR, { recursive: true });
  const file = path.join(env.MP_DATA_DIR, "session_secret.txt");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return new TextEncoder().encode(fs.readFileSync(file, "utf8").trim());
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export class StandaloneHostAdapter implements HostAdapter {
  readonly mode = "standalone" as const;
  readonly publicPaths = ["/api/mp/auth/login"] as const;
  private readonly secret: Uint8Array;

  constructor(private readonly env: Env) {
    if (!env.MP_STANDALONE_PASSWORD) {
      throw new Error("MP_STANDALONE=true requires MP_STANDALONE_PASSWORD in the environment.");
    }
    this.secret = loadOrCreateSecret(env);
  }

  async authenticate(req: FastifyRequest): Promise<HostUser | null> {
    const token = bearerToken(req) ?? req.cookies[STANDALONE_COOKIE] ?? null;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"], issuer: "marketing-pilot" });
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      return sub ? { id: sub, name: sub } : null;
    } catch {
      return null;
    }
  }

  private async issueToken(user: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user)
      .setIssuer("marketing-pilot")
      .setIssuedAt()
      .setExpirationTime(`${SESSION_HOURS}h`)
      .sign(this.secret);
  }

  registerRoutes(app: FastifyInstance): void {
    app.post("/api/mp/auth/login", async (req, reply) => {
      const body = LoginBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ detail: "Benutzer und Passwort angeben." });
      const { user, password } = body.data;
      const ok = safeEqual(user, this.env.MP_STANDALONE_USER) && safeEqual(password, this.env.MP_STANDALONE_PASSWORD ?? "");
      if (!ok) return reply.code(401).send({ detail: "Anmeldung fehlgeschlagen." });
      const token = await this.issueToken(user);
      reply.setCookie(STANDALONE_COOKIE, token, {
        httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
      });
      return { token, user: { id: user, name: user } };
    });
    app.post("/api/mp/auth/logout", async (_req, reply) => {
      this.logout(reply);
      return { ok: true };
    });
  }

  logout(reply: FastifyReply): void {
    reply.clearCookie(STANDALONE_COOKIE, { path: "/" });
  }

  shell(): HostShell {
    return { mode: "standalone", backLink: null, backLabel: null };
  }
}
