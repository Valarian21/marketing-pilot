/** Insights: inbound product events (webhook), aggregation per week/channel/piece, GEO history, landing-page snippet. */
import { clicksByPiece } from "../../shortlinks.js";
import { and, desc, eq } from "drizzle-orm";
import type * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";

export function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;   // Monday = 0
  d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function recordEvent(db: Db, projectId: string, ev: s.InboundEvent): { id: string } {
  const id = newId();
  db.insert(t.mpEvents).values({
    id, projectId, event: ev.event, utmSource: ev.utm.source, utmMedium: ev.utm.medium, utmCampaign: ev.utm.campaign, utmContent: ev.utm.content,
    userRef: ev.userRef, meta: toJson(ev.meta ?? {}), occurredAt: ev.occurredAt ?? nowIso(), receivedAt: nowIso(),
  }).run();
  return { id };
}

export function countEvents(db: Db, projectId: string, event: s.InboundEvent["event"], sinceIso: string, untilIso?: string): number {
  return db.select().from(t.mpEvents).where(and(eq(t.mpEvents.projectId, projectId), eq(t.mpEvents.event, event))).all()
    .filter((e) => e.occurredAt >= sinceIso && (!untilIso || e.occurredAt < untilIso)).length;
}

export function insightsView(db: Db, projectId: string, webhookConfigured: boolean): s.InsightsView {
  const events = db.select().from(t.mpEvents).where(eq(t.mpEvents.projectId, projectId)).all();
  const weeks = new Map<string, { signups: number; activated: number; paid: number }>();
  const channels = new Map<string, { signups: number; activated: number; paid: number }>();
  const byPiece = new Map<string, number>();
  for (const e of events) {
    const w = weekStartOf(e.occurredAt);
    const src = e.utmSource || "(direkt/unbekannt)";
    for (const [map, key] of [[weeks, w], [channels, src]] as const) {
      const cur = map.get(key) ?? { signups: 0, activated: 0, paid: 0 };
      if (e.event === "signup") cur.signups++; else if (e.event === "activated") cur.activated++; else if (e.event === "paid") cur.paid++;
      map.set(key, cur);
    }
    if (e.event === "signup" && e.utmContent) byPiece.set(e.utmContent, (byPiece.get(e.utmContent) ?? 0) + 1);
  }
  const clicks = clicksByPiece(db, projectId);
  const pieces = db.select().from(t.mpContentPieces).where(and(eq(t.mpContentPieces.projectId, projectId), eq(t.mpContentPieces.status, "published"))).all()
    .map((p) => ({ pieceId: p.id, title: p.title, channel: p.channel, format: p.format, signups: byPiece.get(p.id) ?? 0, clicks: clicks.get(p.id) ?? 0, publishedAt: p.publishedAt }))
    .sort((a, b) => b.signups - a.signups || b.clicks - a.clicks);
  const geo = db.select().from(t.mpGeoSnapshots).where(eq(t.mpGeoSnapshots.projectId, projectId)).all();
  const batches = new Map<string, { takenAt: string; asked: number; mentioned: number }>();
  for (const g of geo) { const b = batches.get(g.batch) ?? { takenAt: g.takenAt, asked: 0, mentioned: 0 }; b.asked++; if (g.mentioned) b.mentioned++; batches.set(g.batch, b); }
  return {
    weeks: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([weekStart, v]) => ({ weekStart, ...v })),
    byChannel: [...channels.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.signups - a.signups),
    pieces,
    geoHistory: [...batches.entries()].map(([batch, b]) => ({ batch, takenAt: b.takenAt, asked: b.asked, visibility: b.asked ? b.mentioned / b.asked : 0 })).sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    totalEvents: events.length,
    webhookConfigured,
  };
}

/** ~1 KB landing-page snippet: keeps UTM parameters in a cookie for 90 days and posts them with the signup. */
export function landingSnippet(webhookUrl: string, projectId: string): string {
  return `<script>
(function(){var K="mp_utm",P=["utm_source","utm_medium","utm_campaign","utm_content"],q=new URLSearchParams(location.search),u={},h=false;
P.forEach(function(k){var v=q.get(k);if(v){u[k]=v;h=true}});
if(h){document.cookie=K+"="+encodeURIComponent(JSON.stringify(u))+";max-age=7776000;path=/;SameSite=Lax"}
function read(){var m=document.cookie.match(new RegExp("(?:^|; )"+K+"=([^;]*)"));try{return m?JSON.parse(decodeURIComponent(m[1])):{}}catch(e){return{}}}
window.mpTrack=function(ev,ref){var t=read();try{navigator.sendBeacon?navigator.sendBeacon("${webhookUrl}",new Blob([JSON.stringify({project:"${projectId}",event:ev||"signup",userRef:ref||"",utm:{source:t.utm_source||"",medium:t.utm_medium||"",campaign:t.utm_campaign||"",content:t.utm_content||""}})],{type:"application/json"})):fetch("${webhookUrl}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({project:"${projectId}",event:ev||"signup",userRef:ref||"",utm:{source:t.utm_source||"",medium:t.utm_medium||"",campaign:t.utm_campaign||"",content:t.utm_content||""}}),keepalive:true})}catch(e){}};
window.mpUtm=read;})();
</script>
<!-- Beim Signup aufrufen: mpTrack("signup", userId); später mpTrack("activated"|"paid", userId). Server-seitig: POST ${webhookUrl} mit Bearer MP_EVENTS_TOKEN und denselben Feldern. -->`;
}

export function latestGeoVisibility(db: Db, projectId: string): { current: number | null; previous: number | null } {
  const geo = db.select().from(t.mpGeoSnapshots).where(eq(t.mpGeoSnapshots.projectId, projectId)).orderBy(desc(t.mpGeoSnapshots.takenAt)).all();
  const batches: string[] = [];
  for (const g of geo) if (!batches.includes(g.batch)) batches.push(g.batch);
  const vis = (b: string | undefined) => { if (!b) return null; const xs = geo.filter((g) => g.batch === b); return xs.length ? xs.filter((g) => g.mentioned).length / xs.length : null; };
  return { current: vis(batches[0]), previous: vis(batches[1]) };
}

export { parseJson };
