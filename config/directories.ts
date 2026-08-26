/** Default software directories. Per-project overrides live in mp_settings (`directories:<projectId>`). */
import type { DirectoryDef } from "../src/shared/schemas.js";

export const DEFAULT_DIRECTORIES: DirectoryDef[] = [
  { slug: "producthunt", name: "Product Hunt", submitUrl: "https://www.producthunt.com/posts/new", notes: "Launch an einem Dienstag–Donnerstag, 00:01 PT. Erster Kommentar vom Maker.", taglineMax: 60, screenshotSizes: [{ w: 1270, h: 760 }], fields: ["tagline", "description", "categories", "firstComment", "screenshots"] },
  { slug: "alternativeto", name: "AlternativeTo", submitUrl: "https://alternativeto.net/manage/add-app/", notes: "Alternativen zu bekannten Tools angeben – das treibt die Sichtbarkeit.", taglineMax: 60, screenshotSizes: [{ w: 1280, h: 800 }], fields: ["tagline", "descriptionShort", "alternatives", "categories", "screenshots"] },
  { slug: "g2", name: "G2", submitUrl: "https://www.g2.com/products/new", notes: "Produktprofil beantragen; Reviews später aktiv einholen.", taglineMax: 60, screenshotSizes: [{ w: 1280, h: 800 }], fields: ["tagline", "descriptionLong", "categories", "screenshots"] },
  { slug: "theresanaiforthat", name: "There's An AI For That", submitUrl: "https://theresanaiforthat.com/submit/", notes: "Nur für KI-Produkte sinnvoll.", taglineMax: 60, screenshotSizes: [{ w: 1200, h: 630 }], fields: ["tagline", "descriptionShort", "tags", "screenshots"] },
  { slug: "saashub", name: "SaaSHub", submitUrl: "https://www.saashub.com/submit", notes: "Kostenlos, schnell freigeschaltet.", taglineMax: 60, screenshotSizes: [{ w: 1280, h: 800 }], fields: ["tagline", "descriptionMedium", "alternatives", "categories", "screenshots"] },
];
