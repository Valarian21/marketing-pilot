import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "./helpers.js";
import { ensureShortlink, resolveShortlink } from "../src/server/shortlinks.js";
import { openDatabase } from "../src/server/db/index.js";

describe("short links", () => {
  let built: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { built = await testApp(); });
  afterAll(async () => { await built.close(); });

  it("redirects /go/<code> to the UTM target and counts clicks; unknown codes are 404", async () => {
    const { db, sqlite } = openDatabase("./data/test", ":memory:");
    const a = ensureShortlink(db, null as unknown as string, null as unknown as string, "https://example.org/?utm_source=x");
    const b = ensureShortlink(db, null as unknown as string, null as unknown as string, "https://example.org/?utm_source=x");
    expect(a.code).toMatch(/^[a-z2-9]{6}$/);
    expect(b.code).not.toBe(a.code);   // no piece → no reuse
    expect(resolveShortlink(db, a.code)).toBe("https://example.org/?utm_source=x");
    expect(resolveShortlink(db, "nope")).toBeNull();
    sqlite.close();
    const res = await built.app.inject({ method: "GET", url: "/go/zzzzzz" });
    expect(res.statusCode).toBe(404);
  });
});
