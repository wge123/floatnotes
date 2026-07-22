import { describe, expect, it } from "vitest";

import {
  pushOverlay,
  removeOverlay,
  resolveChord,
  topOverlay,
  type OverlayEntry,
} from "./app-keymap";

const entry = (id: string): OverlayEntry => ({ id, close: () => {} });

describe("Escape/⌘W layering reducer (resolveChord)", () => {
  it("Escape with overlays open closes the top overlay, not the panel", () => {
    expect(resolveChord(2, { key: "Escape", metaKey: false })).toEqual({
      kind: "close-top-overlay",
    });
    expect(resolveChord(1, { key: "Escape", metaKey: false })).toEqual({
      kind: "close-top-overlay",
    });
  });

  it("Escape with an empty overlay stack dismisses the panel (App decides hide vs unfocus)", () => {
    expect(resolveChord(0, { key: "Escape", metaKey: false })).toEqual({
      kind: "dismiss-panel",
    });
  });

  it("⌘W always hides the panel, even with overlays open", () => {
    expect(resolveChord(0, { key: "w", metaKey: true })).toEqual({
      kind: "hide-panel",
    });
    expect(resolveChord(3, { key: "W", metaKey: true })).toEqual({
      kind: "hide-panel",
    });
  });

  it("other keys are none of the keymap's business", () => {
    expect(resolveChord(0, { key: "a", metaKey: false })).toEqual({
      kind: "none",
    });
    expect(resolveChord(1, { key: "w", metaKey: false })).toEqual({
      kind: "none",
    });
    expect(resolveChord(0, { key: "Escape", metaKey: true })).toEqual({
      kind: "none",
    });
  });
});

describe("step-06 app chords", () => {
  const meta = (key: string, shiftKey = false) => ({
    key,
    metaKey: true,
    shiftKey,
  });

  it("⌘N news, ⌘P switches, ⌘K actions, ⌘F finds", () => {
    expect(resolveChord(0, meta("n"))).toEqual({ kind: "new-note" });
    expect(resolveChord(0, meta("p"))).toEqual({ kind: "toggle-switcher" });
    expect(resolveChord(0, meta("k"))).toEqual({ kind: "action-panel" });
    expect(resolveChord(0, meta("f"))).toEqual({ kind: "find" });
  });

  it("⇧⌘P pins; other shifted chords stay untouched", () => {
    expect(resolveChord(0, meta("p", true))).toEqual({ kind: "toggle-pin" });
    expect(resolveChord(0, meta("P", true))).toEqual({ kind: "toggle-pin" });
    expect(resolveChord(0, meta("n", true))).toEqual({ kind: "none" });
    expect(resolveChord(0, meta("z", true))).toEqual({ kind: "none" });
  });

  it("⌘[/⌘] navigate history", () => {
    expect(resolveChord(0, meta("["))).toEqual({ kind: "history-back" });
    expect(resolveChord(0, meta("]"))).toEqual({ kind: "history-forward" });
  });

  it("⌘1–9 jump to pins (0-based)", () => {
    expect(resolveChord(0, meta("1"))).toEqual({
      kind: "pinned-jump",
      index: 0,
    });
    expect(resolveChord(0, meta("9"))).toEqual({
      kind: "pinned-jump",
      index: 8,
    });
  });

  it("⌘= / ⌘- / ⌘0 zoom in, out, and reset (step 09)", () => {
    expect(resolveChord(0, meta("="))).toEqual({ kind: "zoom-in" });
    expect(resolveChord(0, meta("-"))).toEqual({ kind: "zoom-out" });
    expect(resolveChord(0, meta("0"))).toEqual({ kind: "zoom-reset" });
  });

  it("chords resolve the same with overlays open (App owns toggling)", () => {
    expect(resolveChord(2, meta("p"))).toEqual({ kind: "toggle-switcher" });
    expect(resolveChord(1, meta("k"))).toEqual({ kind: "action-panel" });
  });
});

describe("overlay stack helpers", () => {
  it("push/top/remove behave as a LIFO stack", () => {
    let stack: readonly OverlayEntry[] = [];
    stack = pushOverlay(stack, entry("switcher"));
    stack = pushOverlay(stack, entry("action-panel"));

    expect(topOverlay(stack)?.id).toBe("action-panel");
    stack = removeOverlay(stack, "action-panel");
    expect(topOverlay(stack)?.id).toBe("switcher");
    stack = removeOverlay(stack, "switcher");
    expect(topOverlay(stack)).toBeUndefined();
  });

  it("re-pushing an existing id moves it to the top (no duplicates)", () => {
    let stack: readonly OverlayEntry[] = [];
    stack = pushOverlay(stack, entry("a"));
    stack = pushOverlay(stack, entry("b"));
    stack = pushOverlay(stack, entry("a"));

    expect(stack.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("helpers never mutate the input stack", () => {
    const original = [entry("a")];
    const pushed = pushOverlay(original, entry("b"));
    const removed = removeOverlay(original, "a");

    expect(original.map((o) => o.id)).toEqual(["a"]);
    expect(pushed).not.toBe(original);
    expect(removed).not.toBe(original);
  });
});
