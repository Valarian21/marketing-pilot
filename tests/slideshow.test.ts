/**
 * Shot 8: Daten-Reel. Geprüft werden die drei Dinge, bei denen ein Fehler teuer
 * wäre: die ausgeschriebenen Zahlen fürs Voiceover, der Zeitplan (ein Reel darf
 * nicht über 60 s laufen) und die ffmpeg-Aufrufe. Gerendert wird nichts —
 * Renderer und ffmpeg sind Attrappen, die ihre Argumente mitschreiben.
 */
import { describe, expect, it } from "vitest";
import {
  buildSlideArgs, buildSlideshowComposeArgs, englishNumber, estimateReelLineMs, euroInWords, germanNumber,
  MAX_REEL_MS, MIN_SECONDS_PER_CARD, planSlideshow, reelCardLine, reelLayout,
} from "../src/server/agents/video/slideshow.js";
import { formatForTask } from "../src/server/agents/strategy/execute.js";

describe("Zahlen für die Stimme", () => {
  it("schreibt deutsche Zahlen aus", () => {
    expect(germanNumber(1)).toBe("eins");
    expect(germanNumber(21)).toBe("einundzwanzig");
    expect(germanNumber(41)).toBe("einundvierzig");
    expect(germanNumber(626)).toBe("sechshundertsechsundzwanzig");
    expect(germanNumber(1250)).toBe("eintausendzweihundertfünfzig");
    expect(germanNumber(30)).toBe("dreißig");
    expect(germanNumber(100)).toBe("einhundert");
  });
  it("schreibt englische Zahlen aus", () => {
    expect(englishNumber(41)).toBe("forty-one");
    expect(englishNumber(626)).toBe("six hundred twenty-six");
    expect(englishNumber(1250)).toBe("one thousand two hundred fifty");
  });
  it("macht aus 626,08 € einen sprechbaren Preis", () => {
    expect(euroInWords(626.08, "de")).toBe("sechshundertsechsundzwanzig Euro acht");
    expect(euroInWords(41.19, "de")).toBe("einundvierzig Euro neunzehn");
    expect(euroInWords(1250, "de")).toBe("eintausendzweihundertfünfzig Euro");
    expect(euroInWords(1, "de")).toBe("ein Euro");
    expect(euroInWords(626.08, "en")).toBe("six hundred twenty-six euros eight");
    expect(euroInWords(1, "en")).toBe("one euro");
  });
});

describe("Sprechdauer", () => {
  it("schätzt ausgeschriebene Zahlen nicht zu kurz", () => {
    const line = reelCardLine({ rank: 10, name: "Lugia V", priceEur: 626.08 }, "de");
    expect(line).toBe("Platz 10: Lugia V, sechshundertsechsundzwanzig Euro acht.");
    // Der Wort-Schätzer käme auf gut 3 s - gemessen dauert die Zeile über 4.
    expect(estimateReelLineMs(line)).toBeGreaterThan(6000);
  });
});

describe("Zeitplan des Reels", () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `c${i + 1}` }));

  it("nimmt die gewünschte Standzeit, wenn alles passt", () => {
    const p = planSlideshow(cards(10), { secondsPerCard: 1.8 });
    expect(p.secondsPerCard).toBe(1.8);
    expect(p.cards.every((c) => c.durationMs === 1800)).toBe(true);
    expect(p.dropped).toEqual([]);
    expect(p.totalMs).toBe(1500 + 1800 + 2500 + 10 * 1800);
    expect(p.totalMs).toBeLessThanOrEqual(MAX_REEL_MS);
  });

  it("senkt zuerst die Standzeit, bevor eine Karte fliegt", () => {
    const p = planSlideshow(cards(22), { secondsPerCard: 2.5 });
    expect(p.secondsPerCard).toBeGreaterThanOrEqual(MIN_SECONDS_PER_CARD);
    expect(p.secondsPerCard).toBeLessThan(2.5);
    expect(p.dropped).toEqual([]);
    expect(p.totalMs).toBeLessThanOrEqual(MAX_REEL_MS);
  });

  it("kappt danach die hintersten Plätze — die Spitze bleibt immer drin", () => {
    const p = planSlideshow(cards(40), { secondsPerCard: 2.0 });
    expect(p.secondsPerCard).toBe(MIN_SECONDS_PER_CARD);
    expect(p.dropped.length).toBeGreaterThan(0);
    // Im Countdown steht Platz 1 am Ende - gekappt wird vom Anfang der Anzeige.
    expect(p.dropped[0]).toBe("c1");
    expect(p.cards[p.cards.length - 1]!.key).toBe("c40");
    expect(p.totalMs).toBeLessThanOrEqual(MAX_REEL_MS);
  });

  it("gibt einer Karte so viel Zeit, wie ihr Satz braucht", () => {
    const p = planSlideshow([{ key: "a", voiceMs: 4000 }, { key: "b" }], { secondsPerCard: 1.8 });
    expect(p.cards[0]!.durationMs).toBe(4250);
    expect(p.cards[1]!.durationMs).toBe(1800);
  });
});

describe("ffmpeg-Aufrufe", () => {
  it("baut aus einem Standbild ein Segment mit sanftem Zoom", () => {
    const args = buildSlideArgs("/tmp/slide.png", 1800, 1080, 1920, "/tmp/seg.mp4");
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.slice(0, 8)).toEqual(["-loop", "1", "-framerate", "25", "-t", "1.800", "-i", "/tmp/slide.png"]);
    // 45 Frames bei 25 fps - der Zoom läuft genau über die Standzeit
    expect(filter).toContain("zoompan=z='min(1+0.0600*on/45,1.06)'");
    expect(filter).toContain("scale=2160:3840");
    expect(filter).toContain("s=1080x1920");
    expect(args[args.length - 1]).toBe("/tmp/seg.mp4");
  });

  it("legt Untertitel und Stimme über die fertige Bildspur", () => {
    const { args, totalMs } = buildSlideshowComposeArgs({
      body: "/tmp/body.mp4",
      segments: [{ durationMs: 1500, audio: "/tmp/hook.mp3" }, { durationMs: 1800, audio: null }, { durationMs: 2000, audio: "/tmp/c1.mp3" }],
      captions: [{ file: "/tmp/cap-0.png", startMs: 200, endMs: 900 }],
      captionY: reelLayout().captionY, music: null, out: "/tmp/reel.mp4",
    });
    expect(totalMs).toBe(5300);
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("overlay=0:211:eof_action=pass:enable='between(t,0.200,0.900)'");
    // eine Tonspur je Segment, stumme Segmente werden mit Stille aufgefüllt
    expect(filter).toContain("anullsrc=r=44100:cl=stereo,atrim=duration=1.800[sa1]");
    expect(filter).toContain("concat=n=3:v=0:a=1[voice]");
    expect(filter).toContain("loudnorm=I=-14");
    expect(filter).not.toContain("sidechaincompress");
    expect(args).toContain("comment=AI-generated: true (Marketing Pilot, data slideshow)");
  });

  it("duckt die Musik unter die Stimme, wenn ein Bett gewählt ist", () => {
    const { args } = buildSlideshowComposeArgs({
      body: "/tmp/body.mp4", segments: [{ durationMs: 2000, audio: "/tmp/a.mp3" }],
      captions: [], captionY: 211, music: "/tmp/bett.mp3", out: "/tmp/reel.mp4",
    });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("sidechaincompress=threshold=0.012");
    expect(filter).toContain("amix=inputs=2");
  });
});

describe("Aufgaben-Dispatch", () => {
  const task = (title: string, channel = "Instagram") => ({ type: "content", title, channel });
  it("erkennt Ranglisten nur bei Projekten mit Datenquelle", () => {
    expect(formatForTask(task("Die 15 teuersten Karten aus Silberne Sturmwinde"), { hasData: true })).toBe("data_carousel");
    expect(formatForTask(task("Die 15 teuersten Karten aus Silberne Sturmwinde"))).toBe("text");
  });
  it("unterscheidet Carousel und Reel am Wort", () => {
    expect(formatForTask(task("Reel: Die 10 wertvollsten Karten"), { hasData: true })).toBe("data_reel");
    expect(formatForTask(task("Rangliste der teuersten Karten"), { hasData: true })).toBe("data_carousel");
  });
  it("lässt gewöhnliche Aufgaben in Ruhe", () => {
    expect(formatForTask(task("Carousel über den Binder-Planer"), { hasData: true })).toBe("carousel");
    expect(formatForTask(task("App-Demo als Reel"), { hasData: true })).toBe("video");
    expect(formatForTask({ type: "community", title: "Antwort in r/pkmntcg", channel: "Reddit" }, { hasData: true })).toBe("community_reply");
  });
});
