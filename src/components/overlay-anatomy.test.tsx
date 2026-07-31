// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ActionPanel from "./ActionPanel";
import NoteSwitcher from "./NoteSwitcher";

/**
 * UX audit M5: ⌘P and ⌘K are one keystroke apart and share an interaction
 * (type to filter, ↑↓, Enter), but their layouts were mirrored — the switcher
 * put its input on top, the action panel on the bottom — and only the switcher
 * had a keyboard-hint footer. This locks the unified anatomy in:
 *
 *   input → scrolling list → hint footer
 *
 * Plus N2: the switcher card must not be full-bleed at the shipped 420px
 * window, or its rounded corners get clipped and it reads as a sheet.
 *
 * Static rendering only: effects never run, so no api.list()/api.read() fires.
 */
const noop = () => {};

const dialogOf = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const dialog = host.querySelector('[role="dialog"]');
  if (!dialog) throw new Error("no dialog rendered");
  return dialog;
};

/** Tag names of the dialog's direct children, in visual order. */
const anatomyOf = (markup: string) =>
  [...dialogOf(markup).children].map((el) => el.tagName.toLowerCase());

const switcher = () =>
  renderToStaticMarkup(
    <NoteSwitcher
      pins={[]}
      currentNoteId={null}
      onOpen={noop}
      onDelete={noop}
      onClose={noop}
    />,
  );

const panel = () =>
  renderToStaticMarkup(<ActionPanel actions={[]} onClose={noop} />);

describe("overlay anatomy is shared between ⌘P and ⌘K", () => {
  it("both stack input → list → footer, in that order", () => {
    expect(anatomyOf(switcher())).toEqual(["input", "ul", "div"]);
    expect(anatomyOf(panel())).toEqual(["input", "ul", "div"]);
  });

  it("puts the filter input first, above the results (not below)", () => {
    for (const markup of [switcher(), panel()]) {
      const dialog = dialogOf(markup);
      const input = dialog.querySelector("input");
      const list = dialog.querySelector("ul");

      expect(input).not.toBeNull();
      expect(list).not.toBeNull();
      // DOCUMENT_POSITION_FOLLOWING === 4: the list comes after the input.
      expect(input!.compareDocumentPosition(list!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it("both end in a keyboard-hint footer naming ↑↓, Enter and Esc", () => {
    for (const markup of [switcher(), panel()]) {
      const footer = dialogOf(markup).lastElementChild;

      expect(footer?.tagName.toLowerCase()).toBe("div");
      expect(footer?.textContent).toContain("↑↓");
      expect(footer?.textContent).toContain("Enter");
      expect(footer?.textContent).toContain("Esc");
    }
  });

  it("N2: the switcher card is not a fixed full-bleed 420px", () => {
    const dialog = dialogOf(switcher());
    // Token-wise, not substring: "max-w-[420px]" *contains* "w-[420px]".
    const classes = [...dialog.classList];

    expect(classes).not.toContain("w-[420px]");
    expect(classes).toContain("max-w-[420px]");
    // The scrim supplies the gutter that keeps the rounded corners visible.
    expect(dialog.parentElement?.getAttribute("class")).toContain("px-3");
  });
});
