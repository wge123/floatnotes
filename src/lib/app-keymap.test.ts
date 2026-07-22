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
    expect(resolveChord(2, { key: "Escape", metaKey: false })).toBe(
      "close-top-overlay",
    );
    expect(resolveChord(1, { key: "Escape", metaKey: false })).toBe(
      "close-top-overlay",
    );
  });

  it("Escape with an empty overlay stack hides the panel", () => {
    expect(resolveChord(0, { key: "Escape", metaKey: false })).toBe(
      "hide-panel",
    );
  });

  it("⌘W always hides the panel, even with overlays open", () => {
    expect(resolveChord(0, { key: "w", metaKey: true })).toBe("hide-panel");
    expect(resolveChord(3, { key: "W", metaKey: true })).toBe("hide-panel");
  });

  it("other keys are none of the keymap's business", () => {
    expect(resolveChord(0, { key: "a", metaKey: false })).toBe("none");
    expect(resolveChord(1, { key: "w", metaKey: false })).toBe("none");
    expect(resolveChord(0, { key: "Escape", metaKey: true })).toBe("none");
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
