// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import Explorer from "./Explorer";
import type { NoteMeta } from "../lib/api";

/**
 * The Explorer overlay (⌘O) rendered in jsdom against a stubbed note list.
 * Assertions stay at the seam: rendered tiles, ARIA state, callbacks.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const note = (id: string, title: string, mtime: number): NoteMeta => ({
  id,
  title,
  mtime,
  folder: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "",
  snippet: `snippet of ${title}`,
});

const NOTES: NoteMeta[] = [
  note("scratch", "Scratch", 5),
  note("zeta", "Zeta", 9),
  note("research/findings", "Findings doc", 3),
  note("research/alpha", "Alpha doc", 8),
  note("research/deep/one", "Deep one", 1),
  note("work/plan", "Plan", 4),
  note("a/b/c/leaf", "Leaf", 2),
];

let container: HTMLDivElement;
let root: Root;
let onOpen: Mock<(id: string) => void>;
let onClose: Mock<() => void>;
let onNewNote: Mock<(folder: string) => void>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onOpen = vi.fn<(id: string) => void>();
  onClose = vi.fn<() => void>();
  onNewNote = vi.fn<(folder: string) => void>();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const render = (
  currentNoteId: string | null,
  notes: readonly NoteMeta[] | null = NOTES,
) =>
  act(() =>
    root.render(
      <Explorer
        notes={notes}
        currentNoteId={currentNoteId}
        onOpen={onOpen}
        onClose={onClose}
        onNewNote={onNewNote}
      />,
    ),
  );

const tiles = () =>
  [...container.querySelectorAll<HTMLElement>('[role="option"]')];
/** Visible tile names, without the thumbnail snippet text. */
const nameOf = (tile: HTMLElement) =>
  tile.querySelector("[data-tile-label]")?.textContent ?? "";
const labels = () => tiles().map(nameOf);
const selected = () =>
  tiles()
    .filter((t) => t.getAttribute("aria-selected") === "true")
    .map(nameOf);
const listbox = () =>
  container.querySelector<HTMLElement>('[role="listbox"]')!;
const crumbs = () =>
  [
    ...container.querySelectorAll<HTMLElement>('nav[aria-label="Path"] button'),
  ].map((b) => b.textContent);
const tile = (name: string) => {
  const t = tiles().find((x) => nameOf(x) === name);
  if (!t) throw new Error(`no tile ${name}`);
  return t;
};
const button = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const dblclick = (name: string) =>
  act(() => {
    tile(name).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });

function press(
  key: string,
  opts: { metaKey?: boolean; target?: Element } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: opts.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    (opts.target ?? listbox()).dispatchEvent(event);
  });
  return event;
}

/** jsdom has no layout: report a 3-column grid. */
function threeColumns() {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    return el.getAttribute("role") === "listbox"
      ? new Proxy(style, {
          get: (t, p) =>
            p === "gridTemplateColumns"
              ? "80px 80px 80px"
              : Reflect.get(t, p),
        })
      : style;
  });
}

describe("Explorer: where it opens", () => {
  it("opens on the current note's folder with that note selected", () => {
    render("research/findings");

    expect(crumbs()).toEqual(["Notes", "research"]);
    expect(labels()).toEqual(["deep", "Alpha doc", "Findings doc"]);
    expect(selected()).toEqual(["Findings doc"]);
  });

  it("opens at the top level when no note is open", () => {
    render(null);

    expect(crumbs()).toEqual(["Notes"]);
    expect(selected()).toEqual([]);
  });

  it("opens at the top level when the current note is top level", () => {
    render("zeta");

    expect(crumbs()).toEqual(["Notes"]);
    expect(selected()).toEqual(["Zeta"]);
  });
});

describe("Explorer: what it lists", () => {
  it("lists folders first, then notes by most recently edited", () => {
    render(null);

    expect(labels()).toEqual(["a", "research", "work", "Zeta", "Scratch"]);
  });

  it("derives folders from note paths, including ones that only hold subfolders", () => {
    render("a/b/c/leaf");

    expect(crumbs()).toEqual(["Notes", "a", "b", "c"]);
    expect(labels()).toEqual(["Leaf"]);

    act(() => button("Up").click());
    expect(labels()).toEqual(["c"]);
  });

  it("tiles carry the note title; the filename is in the tooltip and status bar", () => {
    render("research/findings");

    expect(tile("Findings doc").getAttribute("title")).toContain(
      "research/findings.md",
    );
    const status = container.querySelector('[role="status"]')?.textContent;
    expect(status).toContain("research/findings.md");
    expect(status).toContain("3 items");
  });

  it("shows only a loading line while the list is not there yet", () => {
    render(null, null);

    expect(tiles()).toHaveLength(0);
    expect(container.textContent).toContain("loading");
  });
});

describe("Explorer: mouse", () => {
  it("single click selects; double click on a folder walks into it", () => {
    render(null);

    act(() => tile("research").click());
    expect(selected()).toEqual(["research"]);
    expect(crumbs()).toEqual(["Notes"]);

    dblclick("research");
    expect(crumbs()).toEqual(["Notes", "research"]);
  });

  it("double click on a note opens it and closes the Explorer", () => {
    render(null);

    dblclick("Zeta");

    expect(onOpen).toHaveBeenCalledWith("zeta");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a path segment navigates there", () => {
    render("a/b/c/leaf");

    const segment = [
      ...container.querySelectorAll<HTMLElement>(
        'nav[aria-label="Path"] button',
      ),
    ].find((b) => b.textContent === "a")!;
    act(() => segment.click());

    expect(crumbs()).toEqual(["Notes", "a"]);
    expect(labels()).toEqual(["b"]);
  });

  it("clicking a sidebar folder navigates there", () => {
    render(null);

    const sidebar = container.querySelector('nav[aria-label="Folders"]')!;
    const work = [...sidebar.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("work"),
    )!;
    act(() => work.click());

    expect(crumbs()).toEqual(["Notes", "work"]);
    expect(labels()).toEqual(["Plan"]);
  });

  it("expands the sidebar along the current path only", () => {
    render("research/deep/one");

    const names = [
      ...container.querySelectorAll('nav[aria-label="Folders"] button'),
    ].map((b) => b.textContent?.replace(/[▾▸]/g, "").trim());
    expect(names).toContain("research");
    expect(names).toContain("deep");
    // the `a` subtree is collapsed: its child `b` is not listed
    expect(names).toContain("a");
    expect(names).not.toContain("b");
  });
});

describe("Explorer: keyboard", () => {
  it("focuses the grid on open so the keys work immediately", () => {
    render(null);

    expect(document.activeElement).toBe(listbox());
  });

  it("arrows move the selection by grid column", () => {
    threeColumns();
    render(null); // a, research, work / Zeta, Scratch

    press("ArrowRight");
    expect(selected()).toEqual(["a"]);
    press("ArrowRight");
    expect(selected()).toEqual(["research"]);
    press("ArrowDown"); // index 1 + 3 = 4
    expect(selected()).toEqual(["Scratch"]);
    press("ArrowUp");
    expect(selected()).toEqual(["research"]);
    press("ArrowLeft");
    press("ArrowLeft"); // clamps at the first tile
    expect(selected()).toEqual(["a"]);
  });

  it("arrows clamp at the end rather than wrapping", () => {
    threeColumns();
    render("scratch");

    press("ArrowDown");
    press("ArrowRight");
    expect(selected()).toEqual(["Scratch"]);
  });

  it("⏎ on a folder walks into it; ⌫ walks back up onto that folder", () => {
    render(null);
    act(() => tile("work").click());

    press("Enter");
    expect(crumbs()).toEqual(["Notes", "work"]);

    press("Backspace");
    expect(crumbs()).toEqual(["Notes"]);
    expect(selected()).toEqual(["work"]);
  });

  it("⏎ and ⌘↓ open a selected note and close", () => {
    render("zeta");
    press("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("zeta");
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => tile("Scratch").click());
    press("ArrowDown", { metaKey: true });
    expect(onOpen).toHaveBeenLastCalledWith("scratch");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("⌘↑ goes up", () => {
    render("research/deep/one");

    press("ArrowUp", { metaKey: true });
    expect(crumbs()).toEqual(["Notes", "research"]);
  });

  it("up at the top level does nothing", () => {
    render(null);

    press("Backspace");
    press("ArrowUp", { metaKey: true });
    expect(crumbs()).toEqual(["Notes"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("⏎ with nothing selected does nothing", () => {
    render(null);

    press("Enter");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves ⌘1–9 (pinned jump) to the app keymap", () => {
    render(null);

    for (const key of ["1", "5", "9"]) {
      expect(press(key, { metaKey: true }).defaultPrevented).toBe(false);
    }
  });
});

describe("Explorer: ⌘N creates in the viewed folder", () => {
  it("passes the viewed folder and closes the Explorer", () => {
    render("research/findings");

    const event = press("n", { metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onNewNote).toHaveBeenCalledExactlyOnceWith("research");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("follows navigation: a folder walked into is the target", () => {
    render(null);
    dblclick("research");
    dblclick("deep");

    press("n", { metaKey: true });

    expect(onNewNote).toHaveBeenCalledExactlyOnceWith("research/deep");
  });

  it("passes the top level as an empty folder", () => {
    render(null);

    press("n", { metaKey: true });

    expect(onNewNote).toHaveBeenCalledExactlyOnceWith("");
  });
});

describe("Explorer: folder history", () => {
  it("⌘[ and ⌘] retrace folder navigation", () => {
    render(null);
    dblclick("research");
    dblclick("deep");
    expect(crumbs()).toEqual(["Notes", "research", "deep"]);

    press("[", { metaKey: true });
    expect(crumbs()).toEqual(["Notes", "research"]);
    press("[", { metaKey: true });
    expect(crumbs()).toEqual(["Notes"]);
    press("[", { metaKey: true }); // at the start: stays
    expect(crumbs()).toEqual(["Notes"]);

    press("]", { metaKey: true });
    press("]", { metaKey: true });
    expect(crumbs()).toEqual(["Notes", "research", "deep"]);
    press("]", { metaKey: true }); // at the end: stays
    expect(crumbs()).toEqual(["Notes", "research", "deep"]);
  });

  it("navigating after going back drops the forward branch", () => {
    render(null);
    dblclick("research");
    press("[", { metaKey: true });
    dblclick("work");

    expect(button("Forward").disabled).toBe(true);
    expect(crumbs()).toEqual(["Notes", "work"]);
  });

  it("toolbar back / forward / up buttons mirror the keys", () => {
    render(null);
    expect(button("Back").disabled).toBe(true);
    expect(button("Up").disabled).toBe(true);

    dblclick("work");
    expect(button("Back").disabled).toBe(false);
    act(() => button("Back").click());
    expect(crumbs()).toEqual(["Notes"]);
    act(() => button("Forward").click());
    expect(crumbs()).toEqual(["Notes", "work"]);
    act(() => button("Up").click());
    expect(crumbs()).toEqual(["Notes"]);
  });
});

describe("Explorer: overlay behaviour", () => {
  it("is a named modal dialog, on the panel and not the scrim", () => {
    render(null);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("Folder explorer");
    expect(container.firstElementChild?.getAttribute("role")).toBeNull();
  });

  it("closes when the scrim is pressed", () => {
    render(null);

    act(() => {
      container.firstElementChild!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("traps Tab: off the last stop returns to the first, ⇧Tab the reverse", () => {
    const decoy = document.createElement("button");
    document.body.prepend(decoy);
    render(null);

    const stops = [
      ...container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = stops[0];
    const last = stops[stops.length - 1];

    act(() => last.focus());
    act(() => {
      last.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      first.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);
    expect(document.activeElement).not.toBe(decoy);
  });
});
