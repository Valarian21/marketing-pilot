/**
 * Kunstseiten aus Binderplans Vitrine.
 *
 * Eine Kunstseite ist eine Binderseite, deren Fächer teils echte Karten und
 * teils ein durchgehendes Bild sind — das Alleinstellungsmerkmal des Produkts,
 * und deshalb eine eigene Content-Kategorie.
 *
 * Anders als beim Binder-Showcase (Shot 11) wird hier **nichts abfotografiert**:
 * die Vitrine hat eine öffentliche Liste und je Seite ein fertiges Vorschaubild.
 * Kein Playwright, kein Browser, keine Wartezeit — nur zwei HTTP-Aufrufe.
 *
 * Gelesen wird ausschließlich; Binderplan merkt von dieser Nutzung nichts außer
 * zwei Anfragen je Lauf.
 */
import fs from "node:fs";
import path from "node:path";

/** Ein Fach der Seite: entweder ein Ausschnitt des Bildes oder eine echte Karte. */
export interface ArtworkFach { art: "artwork" | "card"; kartenId: string }

export interface ArtworkPage {
  id: string;
  titel: string;
  /** Einer der zwölf Stile (`karte`, `aquarell`, `neon`, …). */
  stil: string;
  layout: string;
  besitzer: string;
  /** Gehört die Seite dem Konto, mit dem gelesen wird? Ohne Anmeldung immer `false`. */
  mein: boolean;
  veroeffentlichtAt: string;
  breite: number;
  hoehe: number;
  stimmen: number;
  downloads: number;
  /** Die echten Karten der Seite, in der Reihenfolge der Fächer. */
  karten: { id: string; name: string }[];
  faecher: ArtworkFach[];
  spalten: number;
  zeilen: number;
}

export interface ArtworkOptions {
  /** Binderplans HTTP-Dienst, z. B. `http://127.0.0.1:8103`. */
  apiBase: string;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
}

const TIMEOUT = 30_000;

interface RohFach { art?: string; id?: string }
interface RohSeite { spalten?: number; zeilen?: number; faecher?: RohFach[] }
interface RohArtwork {
  id?: string; titel?: string; stil?: string; layout?: string; besitzer?: string; mein?: boolean;
  veroeffentlicht_at?: string; breite?: number; hoehe?: number; stimmen?: number; downloads?: number;
  karten?: { id?: string; name?: string }[];
  blatt?: { seiten?: RohSeite[] };
}

/**
 * Die öffentlich veröffentlichten Kunstseiten, neueste zuerst.
 *
 * Seiten ohne lesbares Raster fliegen raus: ohne `faecher` lässt sich nicht
 * sagen, welches Fach Bild und welches Karte ist — und genau darauf beruht das
 * ganze Format.
 */
export async function listArtworkPages(opts: ArtworkOptions): Promise<ArtworkPage[]> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.apiBase.replace(/\/$/, "")}/api/vitrine/artwork`;
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Vitrine ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { artworks?: RohArtwork[] };
  const out: ArtworkPage[] = [];
  for (const a of body.artworks ?? []) {
    const seite = a.blatt?.seiten?.[0];
    const faecher = (seite?.faecher ?? []).map((x): ArtworkFach => ({
      art: x.art === "card" ? "card" : "artwork", kartenId: String(x.id ?? ""),
    }));
    if (!a.id || !faecher.length) continue;
    out.push({
      id: a.id,
      titel: (a.titel ?? "").trim() || "Kunstseite",
      stil: (a.stil ?? "").trim(),
      layout: (a.layout ?? "3x3").trim(),
      besitzer: (a.besitzer ?? "").trim(),
      mein: Boolean(a.mein),
      veroeffentlichtAt: (a.veroeffentlicht_at ?? "").trim(),
      breite: Number(a.breite) || 1472,
      hoehe: Number(a.hoehe) || 2032,
      stimmen: Number(a.stimmen) || 0,
      downloads: Number(a.downloads) || 0,
      karten: (a.karten ?? []).map((k) => ({ id: String(k.id ?? ""), name: (k.name ?? "").trim() })).filter((k) => k.id),
      faecher,
      spalten: Number(seite?.spalten) || 3,
      zeilen: Number(seite?.zeilen) || 3,
    });
  }
  opts.log?.(`Vitrine: ${out.length} Kunstseiten mit lesbarem Raster`);
  return out;
}

/**
 * Das Vorschaubild einer Kunstseite auf die Platte legen.
 *
 * Die Vitrine liefert WebP; die Endung richtet sich nach dem, was wirklich
 * kommt, damit `dataUrlFor` den richtigen MIME-Typ bildet.
 */
export async function downloadArtworkImage(id: string, dir: string, opts: ArtworkOptions): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.apiBase.replace(/\/$/, "")}/api/artwork/${encodeURIComponent(id)}/bild?v=vorschau`;
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Kunstseiten-Bild ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const typ = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = typ.includes("png") ? "png" : typ.includes("jpeg") || typ.includes("jpg") ? "jpg" : "webp";
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kunstseite-${id}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Die Fächer, in denen eine echte Karte steckt — mit Namen, soweit die Vitrine ihn kennt. */
export function echteFaecher(page: ArtworkPage): { slot: number; name: string }[] {
  const namen = new Map(page.karten.map((k) => [k.id, k.name]));
  return page.faecher
    .map((f, slot) => ({ slot, art: f.art, name: namen.get(f.kartenId) ?? "" }))
    .filter((x) => x.art === "card")
    .map(({ slot, name }) => ({ slot, name }));
}

/** Wie viele Fächer das Bild trägt — die Zahl, um die es im Beitrag geht. */
export const bildFaecher = (page: ArtworkPage): number => page.faecher.filter((f) => f.art === "artwork").length;
