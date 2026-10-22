import { defineConfig } from "vitest/config";

// Corpus check only (docs/ux-testing.md). The default config never collects
// *.corpus.ts, so `bunx vitest run` stays unaffected.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["scripts/corpus-check/*.corpus.ts"],
    reporters: ["dot"],
  },
});
