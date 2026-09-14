/**
 * Mediathek: Bündel-Geschwister teilen sich die Dateien des Leitstücks und
 * dürfen deshalb weder verschwinden noch ohne Vorschau stehen; Text ohne
 * Dateien ist kein leeres Stück.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import { listMedia, mediaFacets } from "../src/server/routes/media.js";
import { fakeHost } from "./helpers.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "mp-media-"));
const auth = { authorization: "Bearer test-token" };
let built: Awaited<ReturnType<typeof buildApp>>;
let pid = "";

const stueck = (id: string, channel: string, format: string, status: string, assets: string, meta: string) =>
  `INSERT INTO mp_content_pieces (id, project_id, task_id, channel, format, title, body, assets, status, human_edited, published_at, external_url, utm, meta, ai_tell_score, ai_tell_notes, rejection_reason, created_at, updated_at)
   VALUES ('${id}', '${pid}', NULL, '${channel}', '${format}', 'Titel ${id} · ${channel}', 'Text', '${assets}', '${status}', 0, NULL, NULL, '{}', '${meta}', NULL, '', '', '2026-09-0${id.length}T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`;

beforeAll(async () => {
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA }), { host: fakeHost(), dbFile: ":memory:", logger: false });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Binderplan", url: "https://binderplan.app" } })).json().id;
  const dir = path.join(DATA, "assets", pid, "pieces", "lead");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "reel.mp4"), PNG);
  fs.writeFileSync(path.join(dir, "thumb.png"), PNG);
  // Leitstück (Instagram) mit eigenen Dateizeilen …
  built.db.run(stueck("lead", "instagram", "data_reel", "approved", '["v1","t1"]', '{"platform":"instagram","bundleId":"lead","dataQuery":{"kind":"top","set":"sv3pt5"}}') as never);
  built.db.run(`INSERT INTO mp_assets (id, project_id, content_piece_id, kind, path, meta, created_at) VALUES ('v1', '${pid}', 'lead', 'video', 'assets/${pid}/pieces/lead/reel.mp4', '{}', '2026-09-01T00:00:00.000Z')` as never);
  built.db.run(`INSERT INTO mp_assets (id, project_id, content_piece_id, kind, path, meta, created_at) VALUES ('t1', '${pid}', 'lead', 'image', 'assets/${pid}/pieces/lead/thumb.png', '{"role":"thumbnail"}', '2026-09-01T00:00:00.000Z')` as never);
  // … und das TikTok-Geschwister, das nur auf diese Kennungen verweist.
  built.db.run(stueck("tt", "tiktok", "data_reel", "approved", '["v1","t1"]', '{"platform":"tiktok","bundleId":"lead","dataQuery":{"kind":"top","set":"sv3pt5"}}') as never);
  // Ein Threads-Text ohne jede Datei.
  built.db.run(stueck("txt", "threads", "text", "review", '[]', '{"platform":"threads"}') as never);
  // Ein abgelehntes Stück, dessen Datei weg ist.
  built.db.run(stueck("weg", "facebook", "data_carousel", "rejected", '["x9"]', '{"platform":"facebook"}') as never);
  built.db.run(`INSERT INTO mp_assets (id, project_id, content_piece_id, kind, path, meta, created_at) VALUES ('x9', '${pid}', 'weg', 'image', 'assets/${pid}/pieces/weg/fehlt.png', '{}', '2026-09-01T00:00:00.000Z')` as never);
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("Mediathek", () => {
  it("zeigt das Bündel-Geschwister mit den Dateien des Leitstücks", () => {
    const alle = listMedia(built.db, DATA, { limit: 200 });
    const tt = alle.find((m) => m.id === "tt");
    expect(tt).toBeDefined();
    expect(tt!.videoUrl).toBe("/api/mp/assets/v1/file");
    expect(tt!.thumbUrl).toBe("/api/mp/assets/t1/file");
    expect(tt!.bytes).toBeGreaterThan(0);
    expect(tt!.postArt).toBe("B");
  });
  it("blendet Text ohne Dateien nicht aus, wohl aber Stücke, deren Dateien weg sind", () => {
    const ids = listMedia(built.db, DATA, { limit: 200 }).map((m) => m.id);
    expect(ids).toContain("txt");
    expect(ids).not.toContain("weg");
    // Mit ausdrücklichem Status zählt der Filter, nicht die Regel.
    expect(listMedia(built.db, DATA, { limit: 200, status: "rejected" }).map((m) => m.id)).toContain("weg");
  });
  it("liefert die Filterwerte unabhängig vom Ergebnis", async () => {
    const f = mediaFacets(built.db);
    expect(f.platforms).toEqual(["facebook", "instagram", "threads", "tiktok"]);
    expect(f.formats).toContain("text");
    expect(f.projects.map((p) => p.id)).toContain(pid);
    const res = await built.app.inject({ method: "GET", url: "/api/mp/media/facets", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().platforms).toHaveLength(4);
  });
});
