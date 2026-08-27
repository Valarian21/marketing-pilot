import { describe, expect, it } from "vitest";
import { canonicalChannel, channelLink, platformKey, saneTitle } from "../src/shared/channels.js";

describe("channels", () => {
  it("maps task and piece spellings to one canonical channel", () => {
    const plan = ["Instagram", "Reddit r/lehrerzimmer", "Facebook-Gruppen", "Directories"];
    expect(canonicalChannel("instagram", plan)).toBe("Instagram");
    expect(canonicalChannel("Instagram Reels", plan)).toBe("Instagram");
    expect(canonicalChannel("reddit", plan)).toBe("Reddit r/lehrerzimmer");
    expect(canonicalChannel("Reddit r/referendariat", plan)).toBe("Reddit r/referendariat");
    expect(canonicalChannel("AlternativeTo", plan)).toBe("Directories");
    expect(canonicalChannel("linkedin", plan)).toBe("LinkedIn");
    expect(canonicalChannel("", plan)).toBe("Allgemein");
    expect(platformKey("SEO/Vergleichsartikel")).toBe("website");
  });
  it("links channel names to profiles, subreddits or the platform home", () => {
    const profiles = [{ platform: "instagram", label: "Instagram", url: "https://www.instagram.com/lehreule/" }, { platform: "facebook", label: "Grundschule", url: "https://www.facebook.com/groups/1" }, { platform: "facebook", label: "Referendariat", url: "https://www.facebook.com/groups/2" }];
    expect(channelLink("Instagram", profiles).url).toBe("https://www.instagram.com/lehreule/");
    expect(channelLink("Reddit r/lehrerzimmer", profiles).url).toBe("https://www.reddit.com/r/lehrerzimmer/");
    expect(channelLink("Facebook-Gruppen Referendariat", profiles).url).toBe("https://www.facebook.com/groups/2");
    expect(channelLink("Facebook-Gruppen", profiles).url).toBe("https://www.facebook.com/groups/1");
    expect(channelLink("linkedin", []).url).toBe("https://www.linkedin.com/");
    expect(channelLink("Website", profiles).url).toBeNull();
    expect(channelLink("instagram", []).appOnly).toBe(true);
  });
  it("replaces placeholder titles with the first line of the body", () => {
    expect(saneTitle("internal label", "Der Sonntagabend gehört wieder dir – seit ich Lehreule nutze.\n\nMehr Text")).toBe("Der Sonntagabend gehört wieder dir – seit ich Lehreule nutze.");
    expect(saneTitle("Klausur in 10 Minuten", "egal")).toBe("Klausur in 10 Minuten");
    expect(saneTitle("", "", "Aufgabe X")).toBe("Aufgabe X");
  });
});
