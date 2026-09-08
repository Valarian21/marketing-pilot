/**
 * Die Schrift-Einbettung: der Renderer darf nicht davon abhängen, ob Google
 * gerade erreichbar ist. Am 08.09.2026 war es das minutenlang nicht, und jede
 * Slide hing erst 30 s und wurde dann still mit Systemschrift gerendert.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fontHead, fontHeadVergessen, fontsLokal, FONT_CSS_FILE, FONT_LINK_REMOTE } from "../src/server/agents/studio/fonts.js";

describe("Schriften der Slides", () => {
  it("bettet die lokalen Schriften ein, statt sie zu verlinken", () => {
    fontHeadVergessen();
    expect(fontsLokal()).toBe(true);
    const head = fontHead();
    expect(head.startsWith("<style>")).toBe(true);
    expect(head).toContain("data:font/woff2;base64,");
    // Kein Aufruf nach draußen mehr — das ist der ganze Punkt.
    expect(head).not.toContain("fonts.googleapis.com");
    expect(head).not.toContain("fonts.gstatic.com");
  });

  it("hat die Schnitte, die das Marken-Kit verlangt", () => {
    const css = fs.readFileSync(FONT_CSS_FILE, "utf8");
    for (const familie of ["Gabarito", "Nunito Sans", "DM Mono", "Bungee", "Archivo"]) {
      expect(css, `${familie} fehlt in assets/fonts/inline.css — pnpm fonts:fetch`).toContain(`font-family: '${familie}'`);
    }
  });

  it("fällt auf den Google-Link zurück, wenn die Datei fehlt", () => {
    fontHeadVergessen();
    const echt = FONT_CSS_FILE, weg = `${FONT_CSS_FILE}.test-weg`;
    fs.renameSync(echt, weg);
    try { expect(fontHead()).toBe(FONT_LINK_REMOTE); }
    finally { fs.renameSync(weg, echt); fontHeadVergessen(); }
  });
});
