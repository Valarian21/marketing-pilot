import { describe, expect, it } from "vitest";
import { ApprovalLevel, ProjectCreate, Task } from "../src/shared/schemas.js";
import { GEO_MODELS, modelFor } from "../config/models.js";

describe("domain schemas", () => {
  it("defaults nothing silently: approval level must be explicit", () => {
    expect(ApprovalLevel.options).toEqual(["auto", "review", "human_only"]);
    expect(Task.shape.approvalLevel.safeParse(undefined).success).toBe(false);
  });
  it("trims and validates project input", () => {
    expect(ProjectCreate.parse({ name: "  Lehreule ", url: " https://lehreule.de " })).toEqual({ name: "Lehreule", url: "https://lehreule.de" });
    expect(ProjectCreate.safeParse({ name: "x", url: "lehreule.de" }).success).toBe(false);
  });
});

describe("model routing", () => {
  it("routes strategy to the strong and bulk content to the cheap model", () => {
    expect(modelFor("strategy")).toBe(modelFor("analysis"));
    expect(modelFor("content")).not.toBe(modelFor("strategy"));
    expect(GEO_MODELS.length).toBeGreaterThanOrEqual(3);
  });
});
