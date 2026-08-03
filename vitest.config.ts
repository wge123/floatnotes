import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },

  resolve: {
    alias: {
      // Dual-package hazard, and it is not cosmetic: it crashes the editor.
      // ProseMirror's DecorationGroup sorts decoration sets with `instanceof
      // DecorationSet`, so two module instances of prosemirror-view corrupt
      // it. A foreign set fails the check, gets read as if it were a group,
      // and its undefined `.members` lands in the member array, so the next
      // render dies on `undefined.localsInner`.
      //
      // search-and-replace declares `main` (CJS) and `module` (ESM) but no
      // `exports` map, so Node resolves it to the CJS build, whose
      // `require("@tiptap/pm/view")` is a different instance from the ESM one
      // the app gets. It only surfaces when two plugins decorate at once
      // (Placeholder over an empty node plus search-and-replace), i.e. on an
      // empty note or a freshly inserted table.
      //
      // Vite's own build picks `module` and already emits exactly one copy of
      // prosemirror-view, so this is a test-resolver fix only.
      "@sereneinserenade/tiptap-search-and-replace": fileURLToPath(
        new URL(
          "./node_modules/@sereneinserenade/tiptap-search-and-replace/dist/index.js",
          import.meta.url,
        ),
      ),
    },
  },
});
