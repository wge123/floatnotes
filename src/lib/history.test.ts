import { describe, expect, it } from "vitest";

import {
  back,
  canGoBack,
  canGoForward,
  current,
  emptyHistory,
  forward,
  purge,
  visit,
} from "./history";

describe("note history (⌘[ / ⌘])", () => {
  it("starts empty with nothing to navigate", () => {
    expect(current(emptyHistory)).toBeUndefined();
    expect(canGoBack(emptyHistory)).toBe(false);
    expect(canGoForward(emptyHistory)).toBe(false);
    expect(back(emptyHistory)).toBe(emptyHistory);
    expect(forward(emptyHistory)).toBe(emptyHistory);
  });

  it("visit appends and moves the cursor", () => {
    const h = visit(visit(emptyHistory, "a"), "b");
    expect(current(h)).toBe("b");
    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(false);
  });

  it("re-visiting the current note is a no-op", () => {
    const h = visit(emptyHistory, "a");
    expect(visit(h, "a")).toBe(h);
  });

  it("back/forward walk without losing entries", () => {
    let h = visit(visit(visit(emptyHistory, "a"), "b"), "c");
    h = back(h);
    expect(current(h)).toBe("b");
    h = back(h);
    expect(current(h)).toBe("a");
    expect(canGoBack(h)).toBe(false);
    h = forward(h);
    expect(current(h)).toBe("b");
    expect(canGoForward(h)).toBe(true);
  });

  it("visiting after going back truncates the forward tail", () => {
    let h = visit(visit(visit(emptyHistory, "a"), "b"), "c");
    h = back(h); // at b
    h = visit(h, "d");
    expect(current(h)).toBe("d");
    expect(canGoForward(h)).toBe(false);
    expect(back(h).ids).toEqual(["a", "b", "d"]);
  });

  it("history never mutates the input", () => {
    const h1 = visit(emptyHistory, "a");
    const h2 = visit(h1, "b");
    expect(h1.ids).toEqual(["a"]);
    expect(h2).not.toBe(h1);
  });

  it("purge removes a deleted note and keeps the cursor sane", () => {
    let h = visit(visit(visit(emptyHistory, "a"), "b"), "c");
    h = purge(h, "b");
    expect(h.ids).toEqual(["a", "c"]);
    expect(current(h)).toBe("c");
    // purging the current entry falls back to the previous one
    h = purge(h, "c");
    expect(h.ids).toEqual(["a"]);
    expect(current(h)).toBe("a");
  });

  it("purge collapses consecutive duplicates it exposes", () => {
    let h = visit(visit(visit(emptyHistory, "a"), "b"), "a");
    h = purge(h, "b"); // would leave a,a
    expect(h.ids).toEqual(["a"]);
    expect(current(h)).toBe("a");
  });

  it("purging everything returns to empty", () => {
    let h = visit(emptyHistory, "a");
    h = purge(h, "a");
    expect(h.ids).toEqual([]);
    expect(current(h)).toBeUndefined();
    expect(canGoBack(h)).toBe(false);
  });
});
