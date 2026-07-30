// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/react";

import ActionPanel, { type Action } from "./ActionPanel";
import FindBar from "./FindBar";
import NoteSwitcher from "./NoteSwitcher";
import type { Note } from "../lib/api";

/** ⌘P loads its rows over HTTP; the trap only cares that rows exist. */
const notes: Note[] = [
  { id: "a", title: "Alpha", mtime: 2, content: "", path: "/n/a.md" },
  { id: "b", title: "Beta", mtime: 1, content: "", path: "/n/b.md" },
];
vi.mock("../lib/api", () => ({
  api: {
    list: () => Promise.resolve(notes.map(({ id, title, mtime }) => ({ id, title, mtime }))),
    read: (id: string) => Promise.resolve(notes.find((n) => n.id === id)),
  },
}));

/**
 * A11y audit H3, wiring half: the trap is only worth anything if it is
 * actually attached to each overlay's dialog element. `focus-trap.test.ts`
 * pins the algorithm; this mounts the real components and presses Tab.
 *
 * The measured leak: one Tab out of ⌘K's or ⌘F's input landed on a FormatBar
 * button *behind* the overlay — so every case here also asserts that the
 * decoy button standing in for that bar never receives focus.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
/** Stands in for the FormatBar buttons focus escaped to when measured. */
let decoy: HTMLButtonElement;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  decoy = document.createElement("button");
  decoy.textContent = "B";
  container = document.createElement("div");
  document.body.append(decoy, container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

/**
 * A real bubbling Tab keydown — React listens at the root container.
 *
 * jsdom has no native tab order: it never moves focus on Tab. So a press the
 * trap declines to redirect leaves focus exactly where it was, and the honest
 * assertion for those is `defaultPrevented === false` (the browser's own tab
 * order takes it from there) — hence the returned event.
 */
function pressTab(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
}

const stubEditor = {
  commands: {
    setSearchTerm: vi.fn(),
    resetIndex: vi.fn(),
    nextSearchResult: vi.fn(),
    previousSearchResult: vi.fn(),
  },
  storage: { searchAndReplace: { results: [], resultIndex: 0 } },
} as unknown as TiptapEditor;

const actions: Action[] = [
  { id: "new", label: "New Note", run: vi.fn() },
  { id: "pin", label: "Pin Note", run: vi.fn() },
];

describe("overlay focus trap", () => {
  // Audit M5 moved ⌘K's input from the bottom of the card to the top, so the
  // panel's tab order now matches ⌘P's: input first, last action row last.
  // The escape point the trap has to cover moved with it.
  it("ActionPanel: Tab off the last action returns to the search input", () => {
    act(() => root.render(<ActionPanel actions={actions} onClose={vi.fn()} />));
    const input = container.querySelector("input");
    const buttons = [...container.querySelectorAll("button")];
    expect(document.activeElement).toBe(input); // autofocused on open

    act(() => buttons[buttons.length - 1].focus());
    pressTab(); // the last row is the LAST stop — the escape point

    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(decoy);
  });

  it("ActionPanel: ⇧Tab off the search input wraps to the last action", () => {
    act(() => root.render(<ActionPanel actions={actions} onClose={vi.fn()} />));
    const input = container.querySelector("input");
    const buttons = [...container.querySelectorAll("button")];
    expect(document.activeElement).toBe(input);

    pressTab(true); // backwards off the front

    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    expect(document.activeElement).not.toBe(decoy);
  });

  it("ActionPanel: leaves a Tab that stays inside to the browser", () => {
    act(() => root.render(<ActionPanel actions={actions} onClose={vi.fn()} />));
    const buttons = [...container.querySelectorAll("button")];
    act(() => buttons[0].focus());

    expect(pressTab().defaultPrevented).toBe(false);
  });

  it("NoteSwitcher: Tab off the last note row returns to the search input", async () => {
    // The audit could not settle ⌘P either way — six Tab presses against 26+
    // note rows never reached the end. This walks straight to the last row.
    await act(async () => {
      root.render(
        <NoteSwitcher
          pins={[]}
          currentNoteId={null}
          onOpen={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });
    const input = container.querySelector("input");
    const rows = [...container.querySelectorAll("button")];
    expect(rows).toHaveLength(notes.length);

    act(() => rows[rows.length - 1].focus());
    pressTab();

    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(decoy);
  });

  it("FindBar: Tab cycles the bar instead of reaching the page behind", () => {
    act(() => root.render(<FindBar editor={stubEditor} onClose={vi.fn()} />));
    const input = container.querySelector("input");
    // ↑/↓ are disabled with no matches, so ✕ is the last stop in the bar.
    const close = container.querySelector<HTMLElement>(
      '[aria-label="Close find"]',
    );
    expect(document.activeElement).toBe(input);

    // Forward off the end — the measured escape into the FormatBar.
    act(() => close?.focus());
    pressTab();
    expect(document.activeElement).toBe(input);

    // …and backwards off the front.
    pressTab(true);
    expect(document.activeElement).toBe(close);
    expect(document.activeElement).not.toBe(decoy);
  });
});
