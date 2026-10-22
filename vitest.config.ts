import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Agent worktrees hold full copies of the suite; never collect them.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
