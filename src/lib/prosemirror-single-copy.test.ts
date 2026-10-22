import { describe, expect, it } from "vitest";

// Vite's raw glob rather than node:fs: the repo has no @types/node, and
// `tsc` covers test files.
const lock = import.meta.glob("../../bun.lock", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Lock entries for prosemirror-* packages. A top-level package is keyed
 * `"prosemirror-model"`; a copy nested under another package (bun puts one
 * there when the root version does not satisfy a dependent) is keyed
 * `"prosemirror-view/prosemirror-model"`.
 */
function prosemirrorEntries(text: string): string[] {
  return [...text.matchAll(/^ {4}"((?:[^"]+\/)?prosemirror-[^"]+)": \[/gm)].map((m) => m[1]);
}

describe("prosemirror packages", () => {
  // Two copies of prosemirror-model make every paragraph keystroke throw
  // "Can not convert <...> to a Fragment" in the browser (instanceof checks
  // fail across copies), while node-side tests keep passing.
  it("locks exactly one copy of each prosemirror-* package", () => {
    const text = Object.values(lock)[0];
    expect(text).toBeTruthy();
    const entries = prosemirrorEntries(text);
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.filter((key) => key.includes("/"))).toEqual([]);
  });
});
