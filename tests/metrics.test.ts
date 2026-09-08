/**
 * Zahlen je Beitrag: das Übersetzen der Meta-Antworten, der Rückfall auf die
 * kürzere Metrikliste und die Frage, welcher Beitrag überhaupt einen Abruf
 * braucht. Gegen Attrappen — kein Konto, kein Netz.
 */
import { describe, expect, it } from "vitest";
import { facebookMetriken, flach, instagramMetriken } from "../src/server/publish/metrics.js";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fehler = (message: string, status = 400) => new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json" } });
const werte = (paare: Record<string, number>) => ({ data: Object.entries(paare).map(([name, value]) => ({ name, values: [{ value }] })) });

describe("Graph-Antworten lesen", () => {
  it("macht aus der verschachtelten Antwort ein flaches Zahlenpaar", () => {
    expect(flach(werte({ reach: 1200, likes: 34 }))).toEqual({ reach: 1200, likes: 34 });
    // Ein Eintrag ohne Zahl (Meta liefert bei manchen Metriken Objekte) faellt weg.
    expect(flach({ data: [{ name: "x", values: [{ value: { a: 1 } }] }, { name: "reach", values: [{ value: 5 }] }] })).toEqual({ reach: 5 });
  });

  it("übersetzt Instagram auf die gemeinsamen Namen", async () => {
    const impl = (async () => ok(werte({ reach: 1200, views: 4300, likes: 34, comments: 2, saved: 11, shares: 3 }))) as unknown as typeof fetch;
    const m = await instagramMetriken("ig-1", "tok", impl);
    expect(m).toMatchObject({ reichweite: 1200, aufrufe: 4300, likes: 34, kommentare: 2, saves: 11, shares: 3, quelle: "api" });
  });

  /**
   * Meta lehnt die **ganze** Abfrage ab, sobald eine Metrik nicht zum
   * Medientyp passt. Ein zweiter Versuch mit dem kleinsten gemeinsamen Nenner
   * ist deshalb kein Rauschen, sondern der einzige Weg an die Zahlen.
   */
  it("versucht es kürzer, wenn eine Metrik zum Medientyp nicht passt", async () => {
    const gefragt: string[] = [];
    const impl = (async (url: string | URL) => {
      const u = String(url);
      gefragt.push(new URL(u).searchParams.get("metric") ?? "");
      if (gefragt.length === 1) return fehler("(#100) metric[1] must be one of the following values: reach");
      return ok(werte({ reach: 900, likes: 12, comments: 1 }));
    }) as unknown as typeof fetch;
    const m = await instagramMetriken("ig-2", "tok", impl);
    expect(gefragt).toHaveLength(2);
    expect(gefragt[1]!.split(",")).toEqual(["reach", "likes", "comments"]);
    expect(m.reichweite).toBe(900);
    expect(m.aufrufe).toBeNull();
  });

  it("gibt ein fehlendes Recht durch, statt es wegzukürzen", async () => {
    const versuche: string[] = [];
    const impl = (async (url: string | URL) => { versuche.push(String(url)); return fehler("(#10) Application does not have permission for this action"); }) as unknown as typeof fetch;
    await expect(instagramMetriken("ig-3", "tok", impl)).rejects.toThrow(/does not have permission/);
    expect(versuche).toHaveLength(1);   // kein zweiter Versuch
  });

  it("holt Facebooks Reaktionen vom Beitrag, nicht aus den Insights", async () => {
    const impl = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/insights")) return ok(werte({ post_impressions_unique: 500, post_impressions: 640 }));
      return ok({ reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 4 } }, shares: { count: 2 } });
    }) as unknown as typeof fetch;
    const m = await facebookMetriken("fb-1", "tok", impl);
    expect(m).toMatchObject({ reichweite: 500, aufrufe: 640, likes: 9, kommentare: 4, shares: 2 });
  });

  it("liefert die Insights auch, wenn die Zählwerte scheitern", async () => {
    const impl = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/insights")) return ok(werte({ post_impressions_unique: 500 }));
      return fehler("nope");
    }) as unknown as typeof fetch;
    const m = await facebookMetriken("fb-2", "tok", impl);
    expect(m.reichweite).toBe(500);
    expect(m.likes).toBeNull();
  });
});
