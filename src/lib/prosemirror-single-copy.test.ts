import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

/** Every installed copy of a prosemirror-* package, as "name@version path". */
function installedCopies(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.name.startsWith("@")) {
      installedCopies(full, out);
      continue;
    }
    if (entry.name.startsWith("prosemirror-") && existsSync(join(full, "package.json"))) {
      const { version } = JSON.parse(readFileSync(join(full, "package.json"), "utf8"));
      out.push(`${entry.name}@${version} ${full.replace(root + "/", "")}`);
    }
    const nested = join(full, "node_modules");
    if (existsSync(nested)) installedCopies(nested, out);
  }
  return out;
}

describe("prosemirror packages", () => {
  // Two copies of prosemirror-model make every paragraph keystroke throw
  // "Can not convert <...> to a Fragment" in the browser (instanceof checks
  // fail across copies), while node-side tests keep passing.
  it("installs exactly one copy of each prosemirror-* package", () => {
    const copies = installedCopies(join(root, "node_modules"));
    const byName = new Map<string, string[]>();
    for (const c of copies) {
      const name = c.split("@")[0];
      byName.set(name, [...(byName.get(name) ?? []), c]);
    }
    const dupes = [...byName.values()].filter((v) => v.length > 1);
    expect(dupes).toEqual([]);
    expect(byName.size).toBeGreaterThan(5);
  });
});
