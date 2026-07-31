// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { focusableWithin, trapTarget } from "./focus-trap";

/**
 * A11y audit H3: Tab out of an open overlay leaked to the page beneath
 * (`audit-output/a11y/a11y-raw.md` — ⌘K and ⌘F escaped on the FIRST Tab; ⌘P
 * only *looked* trapped because the probe pressed Tab six times against 26+
 * note rows). These lock the wrap-around contract in.
 */
afterEach(() => {
  document.body.innerHTML = "";
});

/** Builds an overlay whose stops are `<button>`s plus a trailing `<input>`. */
function mountOverlay(buttons: number): {
  dialog: HTMLElement;
  outside: HTMLElement;
} {
  const outside = document.createElement("button");
  outside.textContent = "FormatBar B"; // what focus escaped to when measured
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  for (let i = 0; i < buttons; i++) {
    const button = document.createElement("button");
    button.textContent = `action ${i}`;
    dialog.append(button);
  }
  dialog.append(document.createElement("input"));
  document.body.append(outside, dialog);
  return { dialog, outside };
}

const stops = (dialog: HTMLElement) => focusableWithin(dialog);

describe("trapTarget", () => {
  it("wraps to the first stop when Tab would leave the end", () => {
    const { dialog } = mountOverlay(2);
    const [first, , last] = stops(dialog);

    expect(trapTarget(dialog, last, false)).toBe(first);
  });

  it("wraps to the last stop when ⇧Tab would leave the start", () => {
    const { dialog } = mountOverlay(2);
    const all = stops(dialog);

    expect(trapTarget(dialog, all[0], true)).toBe(all[all.length - 1]);
  });

  it("stays out of the way in the middle of the overlay", () => {
    // The browser's own tab order is better at visibility and platform rules
    // than any selector — the trap only exists to close the two ends.
    const { dialog } = mountOverlay(3);
    const middle = stops(dialog)[1];

    expect(trapTarget(dialog, middle, false)).toBeNull();
    expect(trapTarget(dialog, middle, true)).toBeNull();
  });

  it("pulls focus in when it sits on the shell rather than a stop", () => {
    const { dialog, outside } = mountOverlay(1);
    const all = stops(dialog);

    expect(trapTarget(dialog, dialog, false)).toBe(all[0]);
    expect(trapTarget(dialog, outside, true)).toBe(all[all.length - 1]);
    expect(trapTarget(dialog, null, false)).toBe(all[0]);
  });

  it("wraps a single-stop overlay onto itself", () => {
    // ⌘K with a query that matches nothing: the search input is the only stop.
    const { dialog } = mountOverlay(0);
    const only = stops(dialog)[0];

    expect(trapTarget(dialog, only, false)).toBe(only);
    expect(trapTarget(dialog, only, true)).toBe(only);
  });

  it("does not interfere when the overlay has no stops at all", () => {
    const empty = document.createElement("div");
    document.body.append(empty);

    expect(trapTarget(empty, null, false)).toBeNull();
  });
});

describe("focusableWithin", () => {
  it("skips disabled controls", () => {
    // FindBar's ↑/↓ are disabled until the term matches; parking the wrap on a
    // disabled button would drop focus on the floor at the edge.
    const { dialog } = mountOverlay(2);
    const [first, second] = stops(dialog);
    (second as HTMLButtonElement).disabled = true;

    const live = stops(dialog);
    expect(live).not.toContain(second);
    expect(trapTarget(dialog, live[live.length - 1], false)).toBe(first);
  });

  it("skips tabindex=-1 nodes and counts contenteditable ones", () => {
    const dialog = document.createElement("div");
    const skipped = document.createElement("button");
    skipped.tabIndex = -1;
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    dialog.append(skipped, editable);
    document.body.append(dialog);

    expect(stops(dialog)).toEqual([editable]);
  });
});
