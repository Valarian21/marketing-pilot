import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { loadEnv } from "../src/server/env.js";
import { DashboardHostAdapter } from "../src/host-adapter.dashboard.js";
import { StandaloneHostAdapter } from "../src/host-adapter.standalone.js";
import { createHostAdapter } from "../src/host-adapter.js";
import { buildApp } from "../src/server/app.js";

const SECRET = "unit-test-secret-0123456789abcdef";
const key = new TextEncoder().encode(SECRET);
const sign = (claims: Record<string, unknown>, sub = "marcel") =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setExpirationTime("1h").sign(key);

const fakeReq = (headers: Record<string, string> = {}, cookies: Record<string, string> = {}) =>
  ({ headers, cookies } as unknown as Parameters<DashboardHostAdapter["authenticate"]>[0]);

describe("dashboard host adapter", () => {
  const env = loadEnv({ MP_STANDALONE: "false", MP_HOST_JWT_SECRET: SECRET });
  const host = new DashboardHostAdapter(env);

  it("accepts dashboard admin tokens via Bearer and cookie", async () => {
    const token = await sign({});
    expect(await host.authenticate(fakeReq({ authorization: `Bearer ${token}` }))).toEqual({ id: "marcel", name: "marcel" });
    expect(await host.authenticate(fakeReq({}, { empire_session: token }))).toEqual({ id: "marcel", name: "marcel" });
  });

  it("rejects Lehreule (typ=ws) tokens, bad signatures and missing tokens", async () => {
    expect(await host.authenticate(fakeReq({ authorization: `Bearer ${await sign({ typ: "ws" })}` }))).toBeNull();
    const other = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("x").sign(new TextEncoder().encode("wrong"));
    expect(await host.authenticate(fakeReq({ authorization: `Bearer ${other}` }))).toBeNull();
    expect(await host.authenticate(fakeReq())).toBeNull();
  });

  it("is selected by default and reports a back link", async () => {
    const h = await createHostAdapter(env);
    expect(h.mode).toBe("dashboard");
    expect(h.shell()).toEqual({ mode: "dashboard", backLink: "/", backLabel: "Zum Dashboard" });
  });
});

describe("standalone host adapter", () => {
  const env = loadEnv({ MP_STANDALONE: "true", MP_STANDALONE_USER: "marcel", MP_STANDALONE_PASSWORD: "pw", MP_SESSION_SECRET: SECRET, MP_DATA_DIR: "./data/test" });

  it("refuses to start without a password", () => {
    expect(() => new StandaloneHostAdapter(loadEnv({ MP_STANDALONE: "true", MP_STANDALONE_PASSWORD: "", MP_SESSION_SECRET: SECRET })))
      .toThrow(/MP_STANDALONE_PASSWORD/);
  });

  it("logs in, sets a cookie and authenticates subsequent requests", async () => {
    const built = await buildApp(env, { dbFile: ":memory:", logger: false });
    try {
      const bad = await built.app.inject({ method: "POST", url: "/api/mp/auth/login", payload: { user: "marcel", password: "nope" } });
      expect(bad.statusCode).toBe(401);
      const ok = await built.app.inject({ method: "POST", url: "/api/mp/auth/login", payload: { user: "marcel", password: "pw" } });
      expect(ok.statusCode).toBe(200);
      const cookie = ok.cookies.find((c) => c.name === "mp_session");
      expect(cookie?.httpOnly).toBe(true);
      const me = await built.app.inject({ url: "/api/mp/host", cookies: { mp_session: cookie!.value } });
      expect(me.json()).toMatchObject({ mode: "standalone", user: { name: "marcel" }, backLink: null });
      const viaBearer = await built.app.inject({ url: "/api/mp/projects", headers: { authorization: `Bearer ${ok.json().token}` } });
      expect(viaBearer.statusCode).toBe(200);
    } finally {
      await built.close();
    }
  });
});
