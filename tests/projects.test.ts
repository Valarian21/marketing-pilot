import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe("projects API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/mp/projects" });
    expect(res.statusCode).toBe(401);
  });

  it("exposes health and host info publicly", async () => {
    expect((await t.app.inject({ url: "/api/mp/health" })).statusCode).toBe(200);
    const host = await t.app.inject({ url: "/api/mp/host" });
    expect(host.statusCode).toBe(200);
    expect(host.json()).toMatchObject({ mode: "standalone", user: null });
  });

  it("validates input with zod", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/mp/projects", headers: t.auth, payload: { name: "", url: "nope" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/Ungültige Eingabe/);
  });

  it("creates, reads, updates, lists and deletes a project with audit entries", async () => {
    const created = await t.app.inject({ method: "POST", url: "/api/mp/projects", headers: t.auth, payload: { name: "Lehreule", url: "https://lehreule.de" } });
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p).toMatchObject({ name: "Lehreule", url: "https://lehreule.de", status: "draft", brief: {}, brandKit: {} });

    const got = await t.app.inject({ url: `/api/mp/projects/${p.id}`, headers: t.auth });
    expect(got.json().id).toBe(p.id);

    const patched = await t.app.inject({ method: "PATCH", url: `/api/mp/projects/${p.id}`, headers: t.auth, payload: { status: "active", brief: { oneLiner: "Arbeitsblätter in Minuten" } } });
    expect(patched.json()).toMatchObject({ status: "active", brief: { oneLiner: "Arbeitsblätter in Minuten" } });

    const list = await t.app.inject({ url: "/api/mp/projects", headers: t.auth });
    expect(list.json()).toHaveLength(1);

    for (const sub of ["personas", "channels", "tasks", "content", "insights", "geo", "community"]) {
      const r = await t.app.inject({ url: `/api/mp/projects/${p.id}/${sub}`, headers: t.auth });
      expect(r.statusCode, sub).toBe(200);
      expect(r.json()).toEqual([]);
    }

    const stub = await t.app.inject({ method: "POST", url: `/api/mp/projects/${p.id}/strategy/run`, headers: t.auth });
    expect(stub.statusCode).toBe(501);
    expect(stub.json().shot).toBe(2);
    // no OPENROUTER_API_KEY in the test env -> analysis refuses clearly instead of failing late
    const noKey = await t.app.inject({ method: "POST", url: `/api/mp/projects/${p.id}/analysis/run`, headers: t.auth });
    expect(noKey.statusCode).toBe(503);
    expect(noKey.json().detail).toMatch(/OPENROUTER_API_KEY/);

    const del = await t.app.inject({ method: "DELETE", url: `/api/mp/projects/${p.id}`, headers: t.auth });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ url: `/api/mp/projects/${p.id}`, headers: t.auth })).statusCode).toBe(404);

    const audit = await t.app.inject({ url: "/api/mp/audit", headers: t.auth });
    const actions = audit.json().map((a: { action: string; user: string }) => [a.action, a.user]);
    expect(actions).toEqual([["project.delete", "tester"], ["project.update", "tester"], ["project.create", "tester"]]);
  });
});
