/**
 * YouTube misst ohne Google-Projekt: der offene Atom-Feed nennt Aufrufe und
 * Bewertungen je Video. Geprüft wird hier das, was dabei schiefgehen kann —
 * der erste Lauf ohne Vergangenheit, der Zuwachs zum Vortag und ein Feed, aus
 * dem alte Videos herausgefallen sind. Gegen Attrappen, kein Netz.
 */
import { describe, expect, it } from "vitest";
import { youtubeKanal } from "../src/server/publish/kanal-metriken.js";

const feed = (videos: { views: number; sterne?: number }[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><feed><title>binderplan</title>`
  + videos.map((v) => `<entry><title>Video</title><media:group></media:group>`
      + `<media:community><media:starRating count="${v.sterne ?? 0}" average="5.00"/>`
      + `<media:statistics views="${v.views}"/></media:community></entry>`).join("")
  + `</feed>`;

/** Der Feed antwortet, die Kanalseite (Abonnenten) bleibt stumm. */
const netz = (xml: string): typeof fetch => (async (url: string) =>
  String(url).includes("feeds/videos.xml")
    ? new Response(xml, { status: 200 })
    : new Response("", { status: 404 })) as unknown as typeof fetch;

const abruf = (xml: string, vorher?: { aufrufeGesamt?: number; interaktionenGesamt?: number }) => ({
  creds: {}, f: netz(xml), fehlend: () => true, heute: "2026-09-12",
  profilUrl: "https://www.youtube.com/channel/UCOTUbGarALvtqdhExxghvEQ",
  vorher,
});

describe("YouTube-Kanalzahlen aus dem offenen Feed", () => {
  it("summiert Aufrufe und Bewertungen, lässt den Tageswert beim ersten Lauf aber leer", async () => {
    const [tag] = await youtubeKanal(abruf(feed([{ views: 131, sterne: 4 }, { views: 2, sterne: 1 }])));
    expect(tag!.werte.aufrufeGesamt).toBe(133);
    expect(tag!.werte.interaktionenGesamt).toBe(5);
    expect(tag!.werte.beitraege).toBe(2);
    // Ohne früheren Stand gibt es keinen Zuwachs — und keine 0, die wie
    // „niemand hat zugesehen" aussähe.
    expect(tag!.werte.aufrufe).toBeUndefined();
    expect(tag!.werte.interaktionen).toBeUndefined();
  });

  it("bildet den Tageswert als Zuwachs zum letzten gespeicherten Bestand", async () => {
    const [tag] = await youtubeKanal(abruf(feed([{ views: 160, sterne: 6 }, { views: 12, sterne: 1 }]),
      { aufrufeGesamt: 133, interaktionenGesamt: 5 }));
    expect(tag!.werte.aufrufe).toBe(39);
    expect(tag!.werte.interaktionen).toBe(2);
  });

  it("meldet keinen negativen Zuwachs, wenn ein Video aus dem Feed fällt", async () => {
    const [tag] = await youtubeKanal(abruf(feed([{ views: 10 }]), { aufrufeGesamt: 500 }));
    expect(tag!.werte.aufrufe).toBe(0);
    expect(tag!.werte.aufrufeGesamt).toBe(10);
  });

  it("sagt deutlich, wenn keine Kanaladresse hinterlegt ist", async () => {
    await expect(youtubeKanal({ ...abruf(feed([])), profilUrl: "" })).rejects.toThrow(/Kanal-Adresse/);
  });
});
