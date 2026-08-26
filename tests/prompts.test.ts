import { describe, expect, it } from "vitest";
import { attentionMapPrompt, briefPrompt, competitorCandidatesPrompt, competitorDetailPrompt, geoJudgePrompt, geoQuestionsPrompt, personasPrompt } from "../src/server/agents/prompts/analysis.js";
import type { Brief, Competitor, Persona } from "../src/shared/schemas.js";

const brief: Brief = {
  productName: "Beispielwerk", oneLiner: "Erstellt Arbeitsblätter in Minuten.", category: "worksheet generator for teachers", language: "de",
  features: ["Generator", "Export als PDF"], pricing: [{ plan: "Free", price: "0 €", notes: "15 Credits" }], usp: ["Lehrplan-Bezug"],
  tone: "Du, freundlich", targetAudience: "Lehrkräfte an Grundschulen", keywords: ["arbeitsblatt generator"], sources: ["https://example.test/"],
};
const competitor: Competitor = { id: "c1", projectId: "p1", name: "RivalTool", url: "https://rival.test", positioning: "Alles für alle.", pricing: "9 €", complaints: [{ text: "Zu teuer", quote: "viel zu teuer für das Gebotene", source: "Reddit", url: "https://reddit.test/x" }], createdAt: "2026-08-26T00:00:00.000Z" };
const persona: Persona = { id: "pe1", projectId: "p1", name: "Grundschullehrerin", description: "Wenig Zeit.", painPoints: ["Sonntagabend Vorbereitung"], language: "de", phrases: ["ich sitze jeden Sonntag"], objections: ["Datenschutz"], buyingTriggers: ["Schuljahresbeginn"], whereTheyHangOut: ["r/lehrerzimmer"], evidence: [], createdAt: "2026-08-26T00:00:00.000Z" };

describe("analysis prompts (snapshots)", () => {
  it("brief", () => expect(briefPrompt({ url: "https://example.test", pages: [{ url: "https://example.test/", kind: "home", title: "Start", text: "Hallo Welt" }] })).toMatchSnapshot());
  it("competitor candidates", () => expect(competitorCandidatesPrompt({ brief, hits: [{ title: "Rival", url: "https://rival.test", snippet: "Rival tool" }] })).toMatchSnapshot());
  it("competitor detail", () => expect(competitorDetailPrompt({ brief, name: "RivalTool", url: "https://rival.test", pageText: "Website text", reviews: [{ url: "https://reddit.test/x", text: "viel zu teuer" }] })).toMatchSnapshot());
  it("personas", () => expect(personasPrompt({ brief, competitors: [competitor], excerpts: [{ url: "https://example.test/", kind: "home", title: "Start", text: "Hallo" }] })).toMatchSnapshot());
  it("attention map", () => expect(attentionMapPrompt({ brief, personas: [persona], competitors: [competitor], budgetEurMax: 300 })).toMatchSnapshot());
  it("geo questions", () => expect(geoQuestionsPrompt({ brief, personas: [persona], count: 25 })).toMatchSnapshot());
  it("geo judge", () => expect(geoJudgePrompt({ productName: "Beispielwerk", productUrl: "https://example.test", competitors: ["RivalTool"], question: "Bestes Tool?", answers: [{ engine: "m1", text: "RivalTool ist gut." }] })).toMatchSnapshot());
  it("every system prompt carries a task marker", () => {
    for (const m of [briefPrompt({ url: "u", pages: [] }), geoQuestionsPrompt({ brief, personas: [], count: 5 })]) {
      expect(m[0]?.content).toMatch(/^\[task:[a-z-]+\]/);
    }
  });
});
