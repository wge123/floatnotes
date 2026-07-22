import { describe, expect, it } from "vitest";

import { fuzzyScore, rankNotes } from "./fuzzy";

const note = (id: string, title: string, content = "") => ({
  id,
  title,
  content,
});

describe("fuzzyScore", () => {
  it("matches subsequences case-insensitively", () => {
    expect(fuzzyScore("gcy", "Grocery List")).not.toBeNull();
    expect(fuzzyScore("GCY", "grocery list")).not.toBeNull();
    expect(fuzzyScore("xyz", "Grocery List")).toBeNull();
  });

  it("empty query matches everything with score 0", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("consecutive runs outscore scattered hits", () => {
    const tight = fuzzyScore("groc", "grocery")!;
    const scattered = fuzzyScore("groc", "gyro caps orc")!;
    expect(tight).toBeGreaterThan(scattered);
  });

  it("word-boundary hits outscore mid-word hits", () => {
    const boundary = fuzzyScore("ml", "meeting log")!;
    const midWord = fuzzyScore("ml", "family")!;
    expect(boundary).toBeGreaterThan(midWord);
  });
});

describe("rankNotes", () => {
  const notes = [
    note("a", "Groceries", "milk eggs"),
    note("b", "Meeting notes", "discuss groceries budget"),
    note("c", "Ideas", "raycast clone"),
  ];

  it("empty query keeps every note", () => {
    expect(rankNotes("", notes, []).map((r) => r.note.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("filters to title OR content matches", () => {
    const ids = rankNotes("groc", notes, []).map((r) => r.note.id);
    expect(ids).toEqual(["a", "b"]); // c has no match anywhere
  });

  it("title matches always outrank content-only matches", () => {
    // "groceries" appears in b's CONTENT but a's TITLE.
    const ids = rankNotes("groceries", notes, []).map((r) => r.note.id);
    expect(ids[0]).toBe("a");
  });

  it("pinned notes sort above unpinned regardless of score", () => {
    const ids = rankNotes("groc", notes, ["b"]).map((r) => r.note.id);
    expect(ids).toEqual(["b", "a"]);
  });

  it("pinned block leads even with an empty query", () => {
    const ids = rankNotes("", notes, ["c"]).map((r) => r.note.id);
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("marks pinned rows", () => {
    const ranked = rankNotes("", notes, ["a"]);
    expect(ranked[0]).toMatchObject({ pinned: true });
    expect(ranked[1]).toMatchObject({ pinned: false });
  });
});
