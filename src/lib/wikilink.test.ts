import { describe, expect, it } from "vitest";

import type { NoteMeta } from "./api";
import { resolveWikilink } from "./wikilink";

function meta(id: string): NoteMeta {
  return { id, title: id, mtime: 0, folder: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "", snippet: "" };
}

const notes = [
  meta("Note"),
  meta("folder/Deep note"),
  meta("x"),
  meta("a"),
  meta("Folder/Memo"),
  meta("one/00-index"),
  meta("two/00-index"),
];
const ids = (target: string) => resolveWikilink(target, notes).map((n) => n.id);

describe("resolveWikilink", () => {
  it("matches case-insensitively", () => expect(ids("note")).toEqual(["Note"]));
  it("matches the relative path", () => expect(ids("folder/deep note")).toEqual(["folder/Deep note"]));
  it("matches the basename of a nested note", () => expect(ids("Deep note")).toEqual(["folder/Deep note"]));
  it("ignores a trailing .md", () => expect(ids("x.md")).toEqual(["x"]));
  it("drops the alias after |", () => expect(ids("a|alias")).toEqual(["a"]));
  it("trims the target", () => expect(ids("  note  | alias")).toEqual(["Note"]));
  it("strips heading and block refs", () => {
    expect(ids("note#heading")).toEqual(["Note"]);
    expect(ids("note^abc123")).toEqual(["Note"]);
  });
  it("returns every note sharing a basename", () =>
    expect(ids("00-index")).toEqual(["one/00-index", "two/00-index"]));
  it("matches a path with .md", () => expect(ids("Folder/Memo.md")).toEqual(["Folder/Memo"]));
  it("matches the folder case-insensitively", () => expect(ids("folder/memo")).toEqual(["Folder/Memo"]));
  it("returns nothing for an unknown name", () => expect(ids("nope")).toEqual([]));
});
