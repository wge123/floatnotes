// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureFocus, focusEditorSurface } from "./focus-restore";

/**
 * A11y audit H1: closing an overlay must hand focus back where it came from.
 * `audit-output/a11y/a11y-raw.md` measured ⌘P landing on `BODY` and ⌘K/⌘F on a
 * stray FormatBar button — these lock the restore contract in.
 */
afterEach(() => {
  document.body.innerHTML = "";
});

/** Stands in for the ProseMirror surface focus actually comes from. */
function mountEditable(): HTMLElement {
  const editable = document.createElement("div");
  // setAttribute, not the IDL property: jsdom does not reflect `contentEditable`
  // to the attribute, and the attribute is what ProseMirror renders anyway.
  editable.setAttribute("contenteditable", "true");
  // jsdom only treats a node as a focusable area with an explicit tabindex.
  editable.tabIndex = 0;
  document.body.append(editable);
  return editable;
}

describe("captureFocus", () => {
  it("puts focus back on the element that had it", () => {
    const editable = mountEditable();
    editable.focus();
    expect(document.activeElement).toBe(editable);

    const restore = captureFocus();
    const overlayInput = document.createElement("input");
    document.body.append(overlayInput);
    overlayInput.focus();
    expect(document.activeElement).toBe(overlayInput);

    restore();

    expect(document.activeElement).toBe(editable);
  });

  it("falls back when the captured element left the DOM", () => {
    // ⌘P opening a different note remounts Editor under a new key, so the node
    // focus came from no longer exists by the time the overlay closes.
    const editable = mountEditable();
    editable.focus();
    const fallback = vi.fn();
    const restore = captureFocus(fallback);

    editable.remove();
    restore();

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back when nothing was focused (the measured ⌘P → BODY case)", () => {
    const fallback = vi.fn();
    expect(document.activeElement).toBe(document.body);

    captureFocus(fallback)();

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back when the captured element can no longer take focus", () => {
    const target = document.createElement("div");
    target.tabIndex = 0;
    document.body.append(target);
    target.focus();
    const fallback = vi.fn();
    const restore = captureFocus(fallback);

    const overlayInput = document.createElement("input");
    document.body.append(overlayInput);
    overlayInput.focus();
    // Still in the document, but focus() is now a silent no-op — the exact
    // case a bare `previous.focus()` would swallow.
    target.removeAttribute("tabindex");
    restore();

    expect(document.activeElement).toBe(overlayInput);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("resolves the fallback target from the DOM, not a captured node", () => {
    // The note-switch case: the host keeps its identity while the editing
    // surface inside it is swapped for a brand new node.
    const host = document.createElement("div");
    document.body.append(host);
    const stale = mountEditable();
    host.append(stale);

    const restore = captureFocus(() => focusEditorSurface(host));
    stale.remove();
    const fresh = mountEditable();
    host.append(fresh);
    restore();

    expect(document.activeElement).toBe(fresh);
  });

  it("does not call the fallback when the real element takes focus back", () => {
    const editable = mountEditable();
    editable.focus();
    const fallback = vi.fn();
    const restore = captureFocus(fallback);

    const overlayInput = document.createElement("input");
    document.body.append(overlayInput);
    overlayInput.focus();
    restore();

    expect(document.activeElement).toBe(editable);
    expect(fallback).not.toHaveBeenCalled();
  });
});
