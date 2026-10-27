// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta } from "../lib/api";
import WikilinkPicker from "./WikilinkPicker";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const meta = (id: string): NoteMeta => ({ id, title: id, mtime: 0, folder: "", snippet: "" });
const candidates = [meta("a/00-index"), meta("b/00-index"), meta("c/00-index")];

let container: HTMLDivElement;
let root: Root;
let decoy: HTMLButtonElement;
const onOpen = vi.fn();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  onOpen.mockClear();
  decoy = document.createElement("button");
  container = document.createElement("div");
  document.body.append(decoy, container);
  root = createRoot(container);
  act(() => root.render(<WikilinkPicker candidates={candidates} onOpen={onOpen} onClose={vi.fn()} />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

function press(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
}

const listbox = () => container.querySelector<HTMLElement>('[role="listbox"]')!;
const options = () => [...container.querySelectorAll<HTMLElement>('[role="option"]')];

describe("WikilinkPicker", () => {
  it("is a named modal dialog", () => {
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Choose a note");
  });

  it("holds focus on the listbox: Tab and Shift-Tab never leave the dialog", () => {
    expect(document.activeElement).toBe(listbox());
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(listbox());
    expect(document.activeElement).not.toBe(decoy);
  });

  it("keeps the rows out of the Tab order", () => {
    for (const button of container.querySelectorAll("button")) {
      expect(button.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("Enter opens the row the arrows highlighted", () => {
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowUp");
    press("Enter");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(candidates[1]);
  });

  it("aria-activedescendant follows the highlight", () => {
    const active = () => document.getElementById(listbox().getAttribute("aria-activedescendant") ?? "");
    expect(active()).toBe(options()[0]);
    press("ArrowDown");
    expect(active()).toBe(options()[1]);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("titles each row with its full path", () => {
    expect(container.querySelector("button")!.getAttribute("title")).toBe("a/00-index");
  });
});
