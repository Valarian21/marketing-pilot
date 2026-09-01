/**
 * Social-Kit: Profilbilder und Banner für alle Kanäle, aus dem Brand-Kit.
 *
 * Ein neues Konto braucht als Erstes ein Bild — und zwar in acht verschiedenen
 * Zuschnitten, von denen jede Plattform ihren eigenen will. Der Pilot rendert
 * sie aus denselben Tokens wie die Slides: Primärfarbe, Logo (oder ein
 * Monogramm, wenn keins da ist), Produktname, Einzeiler, Domain.
 *
 * Wichtig für die Praxis: die runden Zuschnitte werden **mittig beschnitten**.
 * Deshalb steht im Profilbild nichts am Rand, und jedes Banner hat eine
 * Schutzzone in der Mitte — YouTube zeigt auf dem Handy nur 1546×423 davon.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { getProject } from "../../repo/projects.js";
import { loadBrandKit } from "./brandkit.js";
import { dataUrlFor, istKontur, playwrightRenderer, themeVars, type RenderJob, type Renderer } from "./render.js";
import { markPng, pngSize } from "../../util/png.js";
import { buildZip, safeName, type ZipEntry } from "../../util/zip.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700&family=Nunito+Sans:wght@400;600&family=DM+Mono:wght@500&family=Bungee&family=Archivo:wght@500;600;800&display=swap">`;

export interface SocialFormat {
  key: string;
  label: string;
  /** Wo das Bild hingehört — steht so im UI. */
  usedFor: string;
  w: number;
  h: number;
  kind: "avatar" | "banner";
  /** Hinweis, den man beim Hochladen wissen muss. */
  note: string;
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  { key: "profilbild", label: "Profilbild", usedFor: "Instagram, Threads, TikTok, Facebook, Bluesky, Pinterest, YouTube", w: 1080, h: 1080, kind: "avatar",
    note: "Alle Plattformen schneiden rund zu — nichts Wichtiges an den Rand." },
  { key: "profilbild-telegram", label: "Profilbild (Telegram)", usedFor: "Telegram-Kanal", w: 512, h: 512, kind: "avatar",
    note: "Telegram will mindestens 512 × 512." },
  { key: "banner-1500x500", label: "Banner 1500 × 500", usedFor: "Bluesky, X", w: 1500, h: 500, kind: "banner",
    note: "Auf dem Handy wird links und rechts beschnitten." },
  { key: "banner-facebook", label: "Banner (Facebook-Seite)", usedFor: "Facebook-Seite", w: 1640, h: 856, kind: "banner",
    note: "Auf dem Handy sind oben und unten je ~110 px verdeckt." },
  { key: "banner-youtube", label: "Banner (YouTube)", usedFor: "YouTube-Kanal", w: 2560, h: 1440, kind: "banner",
    note: "Sichtbar ist auf allen Geräten nur die Mitte (1546 × 423) — dort steht der Text." },
  { key: "og-bild", label: "Link-Vorschaubild", usedFor: "Website, WhatsApp, Discord, Link-in-Bio", w: 1200, h: 630, kind: "banner",
    note: "Das Bild, das erscheint, wenn jemand deinen Link teilt." },
];

const base = (kit: s.BrandKit, w: number, h: number, body: string, extra = "") => `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
:root{${themeVars(kit)}} *{box-sizing:border-box;margin:0} html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:var(--f-body);color:var(--b-ink);background:var(--b-bg);-webkit-font-smoothing:antialiased}
.wrap{width:${w}px;height:${h}px;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
${extra}</style></head><body>${body}</body></html>`;

/** Aus „Binderplan" wird „B" — der Notnagel, wenn kein Logo im Brand-Kit liegt. */
const monogram = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

export function avatarHtml(kit: s.BrandKit, a: { brand: string; logoDataUrl: string | null }, w: number, h: number): string {
  // Ein App-Icon bringt seinen eigenen Hintergrund mit; es randlos zu setzen ist
  // im runden Zuschnitt sauberer, als ein Quadrat auf einer Fläche zu zeigen.
  // Ein freigestelltes Logo hat seine eigene Luft und bleibt dabei unbeschnitten.
  if (a.logoDataUrl) {
    return base(kit, w, h, `<div class="wrap" style="background:var(--b-bg)">
<img src="${a.logoDataUrl}" style="width:100%;height:100%;object-fit:contain">
</div>`);
  }
  return base(kit, w, h, `<div class="wrap" style="background:var(--b-primary)">
<div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 25%, rgba(255,255,255,.18), transparent 60%)"></div>
<span style="font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.46)}px;color:var(--b-on-primary);line-height:1">${esc(monogram(a.brand))}</span>
</div>`);
}

export function bannerHtml(kit: s.BrandKit, a: { brand: string; claim: string; domain: string; logoDataUrl: string | null; safeW: number; safeH: number }, w: number, h: number): string {
  const scale = Math.min(a.safeW / 1500, 1);
  const kontur = istKontur(kit);
  // Im Konturstil traegt der Name eine gelbe Unterlegung und das Logo einen
  // schwarzen Kasten — dieselbe Sprache wie auf der Startseite.
  const nameStil = kontur
    ? `font-family:var(--f-display);font-weight:400;font-size:${Math.round(80 * scale)}px;line-height:1.06;letter-spacing:.005em;display:inline-block;position:relative;z-index:1`
    : `font-family:var(--f-display);font-weight:700;font-size:${Math.round(96 * scale)}px;line-height:1.02;letter-spacing:-.02em`;
  const logoStil = kontur
    ? `background:#fff;border:${Math.round(6 * scale)}px solid var(--b-contour);border-radius:${Math.round(a.safeH * 0.09)}px;padding:${Math.round(a.safeH * 0.035)}px;box-shadow:${Math.round(10 * scale)}px ${Math.round(10 * scale)}px 0 var(--b-contour)`
    : `background:#fff;border-radius:${Math.round(a.safeH * 0.1)}px;padding:${Math.round(a.safeH * 0.05)}px`;
  const strich = kontur
    ? `<span style="position:absolute;left:-1.5%;right:-1.5%;bottom:.1em;height:.26em;background:var(--b-accent2);z-index:-1"></span>`
    : "";
  return base(kit, w, h, `<div class="wrap" style="background:var(--b-primary);color:var(--b-on-primary)">
<div style="position:absolute;inset:0;background:linear-gradient(120deg, rgba(255,255,255,.14), transparent 55%)"></div>
${kontur ? `<div style="position:absolute;inset:${Math.round(18 * scale)}px;border:${Math.round(7 * scale)}px solid var(--b-contour);border-radius:${Math.round(14 * scale)}px"></div>` : ""}
<div style="width:${a.safeW}px;height:${a.safeH}px;display:flex;align-items:center;gap:${Math.round(56 * scale)}px;position:relative">
  ${a.logoDataUrl ? `<img src="${a.logoDataUrl}" style="width:${Math.round(a.safeH * 0.5)}px;height:${Math.round(a.safeH * 0.5)}px;object-fit:contain;flex:0 0 auto;${logoStil}">` : ""}
  <div style="min-width:0">
    <div style="position:relative"><span style="${nameStil}">${esc(a.brand)}${strich}</span></div>
    <div style="font-size:${Math.round(34 * scale)}px;line-height:1.32;margin-top:${Math.round(20 * scale)}px;opacity:.94;max-width:${Math.round(a.safeW * 0.78)}px">${esc(a.claim)}</div>
    <div style="font-family:var(--f-mono);font-size:${Math.round(26 * scale)}px;margin-top:${Math.round(20 * scale)}px;opacity:.85;letter-spacing:.02em">${esc(a.domain)}</div>
  </div>
</div></div>`);
}

/** Sichtbarer Bereich je Banner — YouTube ist der einzige Sonderfall. */
function safeArea(f: SocialFormat): { safeW: number; safeH: number } {
  if (f.key === "banner-youtube") return { safeW: 1546, safeH: 423 };
  if (f.key === "banner-facebook") return { safeW: Math.round(f.w * 0.82), safeH: Math.round(f.h * 0.62) };
  return { safeW: Math.round(f.w * 0.86), safeH: Math.round(f.h * 0.7) };
}

export interface SocialKitAsset { format: string; label: string; usedFor: string; note: string; size: string; assetId: string; url: string; filename: string }

/** Was schon erzeugt wurde — je Format das jüngste Bild. */
export function socialKit(db: Db, projectId: string): SocialKitAsset[] {
  const rows = db.select().from(t.mpAssets).where(eq(t.mpAssets.projectId, projectId)).all()
    .filter((a) => parseJson<Record<string, unknown>>(a.meta, {})["socialKit"] === true);
  const out: SocialKitAsset[] = [];
  for (const f of SOCIAL_FORMATS) {
    const hit = rows.filter((a) => parseJson<Record<string, unknown>>(a.meta, {})["format"] === f.key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!hit) continue;
    out.push({ format: f.key, label: f.label, usedFor: f.usedFor, note: f.note, size: `${f.w}×${f.h}`, assetId: hit.id, url: `/api/mp/assets/${hit.id}/file`, filename: path.basename(hit.path) });
  }
  return out;
}

export async function generateSocialKit(
  db: Db, dataDir: string, projectId: string, opts: { renderer?: Renderer; log?: (m: string) => void } = {},
): Promise<SocialKitAsset[]> {
  const log = opts.log;
  const project = getProject(db, projectId);
  if (!project) throw err("Projekt nicht gefunden.", 404);
  const brief = s.Brief.safeParse(project.brief);
  const kit = loadBrandKit(db, projectId);
  const brand = brief.success ? brief.data.productName : project.name;
  const claim = brief.success ? brief.data.oneLiner : "";
  const domain = project.url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Das Logo kommt aus dem Brand-Kit — aber nur, wenn es wirklich eins ist.
  // Der Extraktor nimmt notfalls das og:image, und das ist bei Binderplan ein
  // App-Screenshot: als Kachel im Banner wird daraus unlesbarer Brei. Logos sind
  // annaehernd quadratisch, Screenshots nicht.
  const logoAsset = kit.logoAssetId ? db.select().from(t.mpAssets).where(eq(t.mpAssets.id, kit.logoAssetId)).get() : null;
  const logoFile = logoAsset ? path.join(dataDir, logoAsset.path) : null;
  const dim = logoFile && logoFile.endsWith(".png") ? pngSize(logoFile) : null;
  const looksLikeLogo = !dim || (dim.width / dim.height >= 0.6 && dim.width / dim.height <= 1.7);
  const logoDataUrl = logoFile && looksLikeLogo ? dataUrlFor(logoFile) : null;
  if (logoFile && !looksLikeLogo) log?.(`Social-Kit: ${path.basename(logoFile)} ist ${dim!.width}×${dim!.height} und damit kein Logo — Monogramm verwendet.`);

  const outDir = path.join(dataDir, "assets", projectId, "socialkit");
  fs.mkdirSync(outDir, { recursive: true });
  const jobs: RenderJob[] = [];
  const files: { f: SocialFormat; file: string }[] = [];
  for (const f of SOCIAL_FORMATS) {
    const file = path.join(outDir, `${safeName(brand)}-${f.key}-${f.w}x${f.h}.png`);
    const html = f.kind === "avatar"
      ? avatarHtml(kit, { brand, logoDataUrl }, f.w, f.h)
      : bannerHtml(kit, { brand, claim, domain, logoDataUrl, ...safeArea(f) }, f.w, f.h);
    jobs.push({ html, width: f.w, height: f.h, file });
    files.push({ f, file });
  }
  await (opts.renderer ?? playwrightRenderer)(jobs);

  // Alte Kit-Bilder ersetzen: es soll immer nur ein gültiger Satz herumliegen.
  for (const old of db.select().from(t.mpAssets).where(eq(t.mpAssets.projectId, projectId)).all()) {
    if (parseJson<Record<string, unknown>>(old.meta, {})["socialKit"] !== true) continue;
    if (!files.some((x) => path.relative(dataDir, x.file) === old.path)) { try { fs.unlinkSync(path.join(dataDir, old.path)); } catch { /* weg */ } }
    db.delete(t.mpAssets).where(eq(t.mpAssets.id, old.id)).run();
  }
  const ts = nowIso();
  for (const { f, file } of files) {
    markPng(file, { aiGenerated: true, generator: "Marketing Pilot (Social-Kit)" });
    db.insert(t.mpAssets).values({
      id: newId(), projectId, contentPieceId: null, kind: "image", path: path.relative(dataDir, file),
      meta: toJson({ socialKit: true, format: f.key, size: `${f.w}x${f.h}`, aiGenerated: true, provenance: "png-text-chunk" }),
      createdAt: ts,
    }).run();
  }
  return socialKit(db, projectId);
}

/** Alles in einer Datei — das ist es, was man beim Einrichten wirklich braucht. */
export function socialKitZip(db: Db, dataDir: string, projectId: string): { name: string; data: Buffer } | null {
  const items = socialKit(db, projectId);
  if (!items.length) return null;
  const project = getProject(db, projectId);
  const entries: ZipEntry[] = [];
  for (const it of items) {
    const row = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, it.assetId)).get();
    if (!row) continue;
    const file = path.join(dataDir, row.path);
    if (fs.existsSync(file)) entries.push({ name: it.filename, data: fs.readFileSync(file) });
  }
  if (!entries.length) return null;
  // Eine Kurzanleitung dazu - sonst raet man beim Hochladen, was wohin gehoert.
  entries.push({
    name: "WOHIN-GEHOERT-WAS.txt",
    data: Buffer.from([
      `Social-Kit für ${project?.name ?? "das Projekt"}`,
      "",
      ...items.map((i) => `${i.filename}\n  ${i.size} · ${i.usedFor}\n  ${i.note}\n`),
      "Erzeugt vom Marketing Pilot. Farben und Logo stammen aus dem Brand-Kit des Projekts;",
      "wer sie ändert, erzeugt das Kit einfach neu.",
    ].join("\n"), "utf8"),
  });
  return { name: `${safeName(project?.name ?? "social-kit")}-social-kit.zip`, data: buildZip(entries) };
}
