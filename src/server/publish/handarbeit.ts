/**
 * Handarbeit: die Warteschlange für Kanäle ohne Veröffentlichungs-API.
 *
 * TikTok gibt keine her, YouTube Shorts lädt man in Studio hoch. Für diese
 * Kanäle bereitet der Pilot alles vor — Video, Text, Hashtags, Kurzlink —, das
 * Posten bleibt aber Handarbeit. Bisher führte der Weg über die Publish-Seite,
 * und die zeigt genau **ein** Stück. Für eine Woche TikTok wären das sieben
 * Einzelaufrufe mit je drei Klicks; am 13.09.2026 lagen deshalb 24 freigegebene
 * TikTok-Stücke ungenutzt herum, während der Kanal mit 4.123 Aufrufen der
 * reichweitenstärkste von allen war.
 *
 * Diese Ansicht legt sie nebeneinander und gibt ihnen Termine. Ein Termin ist
 * hier kein Auftrag an den Poster — für diese Kanäle gibt es keinen —, sondern
 * ein Merkzettel: `origin: "extern"`, Status `queued`, bis der Haken kommt.
 */
import { and, eq } from "drizzle-orm";
import type * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import type { Db } from "../db/index.js";
import { PLATFORMS, platformKey } from "../../shared/channels.js";
import { loadProfiles } from "../channels.js";
import { buildPackage, pieceOf, type StudioContext } from "../agents/studio/generate.js";
import { posterFor } from "./index.js";
import { recordExternPost } from "./schedule.js";

/** Kanäle, die von Hand bespielt werden: es gibt keinen Poster für sie. */
export function handKanaele(db: Db, projectId: string): string[] {
  const ausProfilen = loadProfiles(db, projectId).map((p) => p.platform);
  const ausStuecken = db.select({ c: t.mpContentPieces.channel }).from(t.mpContentPieces)
    .where(eq(t.mpContentPieces.projectId, projectId)).all()
    .map((r) => platformKey(r.c ?? "") ?? "").filter(Boolean);
  // Pinterest hat zwar einen API-Poster, aber der braucht ein Entwickler-Token,
  // das niemand hat. Bespielt wird es seit dem 21.09.2026 über den Anmelde-
  // Browser (pinterest-studio.ts) — also von hier aus.
  return [...new Set([...ausProfilen, ...ausStuecken])].filter((p) => p && (!posterFor(p) || p === "pinterest"));
}

/**
 * Der Termin eines Stücks auf einem Handkanal — der jüngste nicht abgesagte
 * extern-Eintrag. Mehr als einen gibt es nicht: `recordExternPost` fasst nach.
 */
function terminFuer(db: Db, pieceId: string, platform: string) {
  return db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.pieceId, pieceId), eq(t.mpScheduledPosts.platform, platform))).all()
    .find((x) => x.origin === "extern" && x.status !== "cancelled") ?? null;
}

export function handarbeitView(ctx: StudioContext, projectId: string, nurPlatform?: string): s.HandarbeitView {
  const kanaele = handKanaele(ctx.db, projectId).filter((p) => !nurPlatform || p === nurPlatform);
  const profile = loadProfiles(ctx.db, projectId);
  const stuecke = ctx.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all()
    .map(pieceOf)
    // Nur was freigegeben ist. Ein Stueck in „review" gehoert in die Freigabe,
    // nicht in die Warteschlange — sonst postet man versehentlich Entwuerfe.
    .filter((p) => p.status === "approved" || p.status === "published")
    .filter((p) => kanaele.includes(platformKey(p.channel ?? "") ?? ""));

  const eintraege: s.HandarbeitEintrag[] = stuecke.map((piece) => {
    const platform = platformKey(piece.channel ?? "") ?? "";
    const pkg = buildPackage(ctx, piece);
    const termin = terminFuer(ctx.db, piece.id, platform);
    const gepostet = termin?.status === "posted" || piece.status === "published";
    return {
      pieceId: piece.id,
      titel: piece.title || piece.format,
      platform, format: piece.format,
      text: pkg.text,
      hinweise: pkg.notes,
      dateien: pkg.assets.map((a) => ({ id: a.id, kind: a.kind, url: a.url, filename: a.filename })),
      geplantAm: termin?.scheduledAt ?? null,
      gepostet,
      externalUrl: termin?.externalUrl ?? piece.externalUrl ?? null,
      // Auf TikTok und YouTube ist kein Link im Text klickbar — er gehoert in die Bio.
      linkFuerBio: pkg.shortLink ?? pkg.utmLink,
    };
  }).sort((a: s.HandarbeitEintrag, b: s.HandarbeitEintrag) => {
    // Zuerst, was einen Termin hat (nach Termin), dann der Rest nach Titel.
    if (a.geplantAm && b.geplantAm) return a.geplantAm.localeCompare(b.geplantAm);
    if (a.geplantAm) return -1;
    if (b.geplantAm) return 1;
    return a.titel.localeCompare(b.titel);
  });

  return {
    kanaele: kanaele.map((platform) => {
      const meine = eintraege.filter((e) => e.platform === platform);
      return {
        platform,
        label: PLATFORMS[platform]?.label ?? platform,
        profilUrl: profile.find((p) => p.platform === platform)?.url || null,
        offen: meine.filter((e) => !e.gepostet && !e.geplantAm).length,
        geplant: meine.filter((e) => !e.gepostet && e.geplantAm).length,
        gepostet: meine.filter((e) => e.gepostet).length,
      };
    }),
    eintraege,
  };
}

/**
 * Offene Stücke eines Kanals auf Tage verteilen.
 *
 * Verteilt wird nur, was noch keinen Termin hat und noch nicht gepostet ist —
 * ein zweiter Aufruf verschiebt also nichts, sondern füllt auf. Die Uhrzeit ist
 * Berliner Zeit; gerechnet wird über den Offset des Zieltages, damit die
 * Sommerzeit nicht ins Rutschen kommt.
 */
export function verteilen(ctx: StudioContext, projectId: string, input: s.VerteilenRequest, user: { id: string; name: string }): number {
  const view = handarbeitView(ctx, projectId, input.platform);
  const offen = view.eintraege.filter((e) => !e.gepostet && !e.geplantAm).slice(0, input.anzahl);
  let gesetzt = 0;
  for (let i = 0; i < offen.length; i++) {
    const tagVersatz = Math.floor(i / input.proTag);
    const inTag = i % input.proTag;
    const tag = new Date(`${input.ab}T00:00:00Z`);
    tag.setUTCDate(tag.getUTCDate() + tagVersatz);
    const datum = tag.toISOString().slice(0, 10);
    // Mehrere je Tag ruecken um zwei Stunden auseinander, damit sie sich im Feed
    // nicht gegenseitig ueberholen.
    const stunde = Math.min(23, input.stunde + inTag * 2);
    const berlin = new Date(`${datum}T${String(stunde).padStart(2, "0")}:00:00+02:00`);
    recordExternPost(ctx.db, projectId, {
      pieceId: offen[i]!.pieceId, platform: input.platform,
      scheduledAt: berlin.toISOString(), externalUrl: "", posted: false,
    });
    gesetzt++;
  }
  void user;
  return gesetzt;
}
