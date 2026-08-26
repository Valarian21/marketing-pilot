import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Prompt snapshots (Shot 1+) are stored next to the tests as fixtures.
    snapshotFormat: { printBasicPrototype: false },
  },
});
