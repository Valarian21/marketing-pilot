/** Musikbett: Upload mit Nachweis, Pausieren per Unterstrich, Löschen räumt beides weg. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "./helpers.js";
import { dateiSlug } from "../src/server/routes/music.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-musik-"));
process.env["MP_MUSIC_DIR"] = dir;

function testWav(): Buffer | null {
  const f = path.join(dir, "_probe.wav");
  try { execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", f]); }
  catch { return null; }
  const b = fs.readFileSync(f); fs.rmSync(f); return b;
}

describe("Musikbett", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env["MP_MUSIC_DIR"]; });

  it("macht aus Titeln Dateinamen", () => {
    expect(dateiSlug("Sommer-Lauf (Remix)!")).toBe("sommer-lauf-remix");
    expect(dateiSlug("Größe & Stärke")).toBe("groesse-staerke");
    expect(dateiSlug("!!!")).toBe("track");
  });

  it("weist Datenmüll ab, statt ihn in den Ordner zu legen", async () => {
    const r = await t.app.inject({ method: "POST", url: "/api/mp/music?name=x.mp3&titel=Test&lizenz=CC0", headers: { ...t.auth, "content-type": "application/octet-stream" }, payload: Buffer.from("kein audio") });
    expect(r.statusCode).toBe(400);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".mp3"))).toEqual([]);
  });

  it("lehnt CC-BY als Lizenz ab", async () => {
    const r = await t.app.inject({ method: "POST", url: "/api/mp/music?name=x.mp3&titel=Test&lizenz=CC-BY", headers: { ...t.auth, "content-type": "application/octet-stream" }, payload: Buffer.from("x") });
    expect(r.statusCode).toBe(400);
  });

  it("lädt hoch, warnt bei Kürze, pausiert und löscht", async () => {
    const wav = testWav();
    if (!wav) return; // ohne ffmpeg kein Ende-zu-Ende
    const up = await t.app.inject({ method: "POST", url: "/api/mp/music?name=probe.wav&titel=Sommer%20Lauf&urheber=Tester&quelle=https://example.org/t&lizenz=CC0", headers: { ...t.auth, "content-type": "application/octet-stream" }, payload: wav });
    expect(up.statusCode).toBe(201);
    const { track, warnings } = up.json();
    expect(track.file).toBe("sommer-lauf.wav");
    expect(track.aktiv).toBe(true);
    expect(track.lizenz).toBe("CC0");
    expect(warnings.some((w: string) => /zu kurz|Nur 1 s/.test(w))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "sommer-lauf.txt"), "utf8")).toContain("Urheber: Tester");

    const list = await t.app.inject({ url: "/api/mp/music", headers: t.auth });
    expect(list.json().tracks).toHaveLength(1);

    const pause = await t.app.inject({ method: "POST", url: "/api/mp/music/sommer-lauf.wav/toggle", headers: t.auth });
    expect(pause.json()).toMatchObject({ file: "_sommer-lauf.wav", aktiv: false, lizenz: "CC0" });

    const del = await t.app.inject({ method: "DELETE", url: "/api/mp/music/_sommer-lauf.wav", headers: t.auth });
    expect(del.statusCode).toBe(204);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
