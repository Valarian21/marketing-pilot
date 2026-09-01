/**
 * Link-in-Bio-Seite (`/go/bio/<code>`).
 *
 * Instagram und TikTok lassen keinen klickbaren Link im Beitrag zu — deshalb
 * trägt Marcel **eine** Adresse ins Profil ein, und die zeigt immer auf das
 * Aktuelle. Die Seite ist bewusst eine einzige, serverseitig gebaute HTML-Datei
 * ohne Skript: sie muss auf jedem Handy in einer halben Sekunde stehen.
 *
 * Gezählt wird über dieselbe Kurzlink-Mechanik wie im Publish-Paket, damit die
 * Klicks in den Insights an denselben Stücken landen.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "../db/index.js";
import { BioSettings, Brief, type BrandKit } from "../../shared/schemas.js";
import { loadBrandKit } from "../agents/studio/brandkit.js";
import { getProject } from "../repo/projects.js";
import { ensureShortlink, shortUrl } from "../shortlinks.js";
import { buildUtmUrl, slugify } from "../util/utm.js";

const key = (projectId: string) => `bio:${projectId}`;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function loadBio(db: Db, projectId: string): BioSettings {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  const parsed = BioSettings.safeParse(parseJson(row?.value ?? "{}", {}));
  return parsed.success ? parsed.data : BioSettings.parse({});
}

export function saveBio(db: Db, projectId: string, patch: Record<string, unknown>): BioSettings {
  const cur = loadBio(db, projectId);
  // Der Code wird einmal vergeben und nie wieder geändert: er steht in den
  // Profilen der Plattformen und darf nicht unter Marcels Händen wegbrechen.
  const code = cur.code || newCode(db);
  // `code` bleibt in jedem Fall stehen, auch wenn ihn jemand mitschickt.
  const next = BioSettings.parse({ ...cur, ...patch, code });
  db.insert(t.mpSettings).values({ key: key(projectId), value: toJson(next), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(next), updatedAt: nowIso() } }).run();
  return next;
}

function newCode(db: Db): string {
  for (let i = 0; i < 10; i++) {
    const code = [...crypto.randomBytes(5)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    if (!projectByBioCode(db, code)) return code;
  }
  throw new Error("Kein freier Bio-Code gefunden.");
}

export function projectByBioCode(db: Db, code: string): string | null {
  for (const row of db.select().from(t.mpSettings).all()) {
    if (!row.key.startsWith("bio:")) continue;
    const parsed = BioSettings.safeParse(parseJson(row.value, {}));
    if (parsed.success && parsed.data.code === code) return row.key.slice(4);
  }
  return null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Die Seite selbst — oder `null`, wenn es sie (noch) nicht gibt. */
export function bioHtml(db: Db, projectId: string, publicBase: string): string | null {
  const bio = loadBio(db, projectId);
  const project = getProject(db, projectId);
  if (!bio.enabled || !project) return null;
  const brief = Brief.safeParse(project.brief);
  const brand = brief.success ? brief.data.productName : project.name;
  const kit: BrandKit = loadBrandKit(db, projectId);
  const primary = kit.primary ?? "#3D7A4E";
  const ink = kit.ink ?? "#1E2A20";
  const bg = kit.background ?? "#FFFFFF";

  const mainLink = buildUtmUrl(project.url, { source: "bio", medium: "social", campaign: "link-in-bio" });
  const pieces = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all()
    .filter((p) => p.status === "published")
    .filter((p) => parseJson<Record<string, unknown>>(p.meta, {})["inBio"] !== false)
    .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt))
    .slice(0, bio.latest);

  const rows = pieces.map((p) => {
    const utm = buildUtmUrl(project.url, { source: "bio", medium: "social", campaign: slugify(p.channel || "bio"), content: p.id });
    const code = ensureShortlink(db, projectId, p.id, utm).code;
    return `<a class="row" href="${esc(shortUrl(publicBase, code))}"><span>${esc(p.title || brand)}</span><span class="chev">→</span></a>`;
  }).join("\n");

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(bio.headline || brand)}</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@700&family=Nunito+Sans:wght@400;600&display=swap">
<style>
:root{--p:${primary};--i:${ink};--b:${bg}}
*{box-sizing:border-box;margin:0}
body{font-family:"Nunito Sans",system-ui,sans-serif;background:var(--b);color:var(--i);min-height:100vh;display:flex;justify-content:center;padding:2.5rem 1.25rem 4rem}
main{width:100%;max-width:26rem}
h1{font-family:"Gabarito",system-ui,sans-serif;font-size:1.9rem;line-height:1.1;letter-spacing:-.01em}
p.intro{margin-top:.6rem;opacity:.75;line-height:1.45}
.cta{display:block;margin:1.6rem 0 1.1rem;padding:1rem;border-radius:.75rem;background:var(--p);color:#fff;text-align:center;font-weight:600;text-decoration:none}
.row{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.9rem 1rem;border:1px solid color-mix(in srgb,var(--i) 14%,transparent);border-radius:.75rem;margin-bottom:.6rem;color:inherit;text-decoration:none}
.row:hover{border-color:var(--p)}
.chev{opacity:.5}
footer{margin-top:2rem;font-size:.8rem;opacity:.6;text-align:center}
</style></head><body><main>
<h1>${esc(bio.headline || brand)}</h1>
${bio.intro ? `<p class="intro">${esc(bio.intro)}</p>` : ""}
<a class="cta" href="${esc(mainLink)}">${esc(brand)} öffnen</a>
${rows}
<footer>${esc(project.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</footer>
</main></body></html>`;
}
