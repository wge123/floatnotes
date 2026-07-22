import { describe, expect, it } from "vitest";

import { shouldApplyExternal } from "./external-sync";

describe("caret guard (shouldApplyExternal)", () => {
  it("skips the echo of our own onChange — identical content is never applied", () => {
    expect(shouldApplyExternal("# Note\n\nbody", "# Note\n\nbody")).toBe(false);
  });

  it("applies genuinely different external content", () => {
    expect(shouldApplyExternal("# Note", "# Note (edited elsewhere)")).toBe(
      true,
    );
  });

  it("treats whitespace-only differences as real changes", () => {
    expect(shouldApplyExternal("# Note", "# Note\n")).toBe(true);
  });
});
