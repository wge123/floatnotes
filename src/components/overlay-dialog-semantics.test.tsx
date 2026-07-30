// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/react";

import ActionPanel from "./ActionPanel";
import FindBar from "./FindBar";
import NoteSwitcher from "./NoteSwitcher";

/**
 * A11y audit H2: each overlay must announce itself as a dialog with a name.
 * `audit-output/a11y/a11y-raw.md` measured 0 `role="dialog"` and 0 `aria-modal`
 * nodes across all three overlays — this locks the fix in.
 *
 * Static rendering only: effects never run, so no fetch/editor calls fire and
 * the stub editor below is never touched.
 */
const noop = () => {};

/** FindBar only touches the editor from effects/handlers, which never run here. */
const stubEditor = {} as unknown as TiptapEditor;

const parse = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
};

const dialogsIn = (markup: string) => [
  ...parse(markup).querySelectorAll('[role="dialog"]'),
];

describe("overlay dialog semantics", () => {
  it("NoteSwitcher is a named modal dialog", () => {
    const dialogs = dialogsIn(
      renderToStaticMarkup(
        <NoteSwitcher
          pins={[]}
          currentNoteId={null}
          onOpen={noop}
          onDelete={noop}
          onClose={noop}
        />,
      ),
    );

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute("aria-modal")).toBe("true");
    expect(dialogs[0].getAttribute("aria-label")).toBe("Note switcher");
  });

  it("ActionPanel is a named modal dialog", () => {
    const dialogs = dialogsIn(
      renderToStaticMarkup(<ActionPanel actions={[]} onClose={noop} />),
    );

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute("aria-modal")).toBe("true");
    expect(dialogs[0].getAttribute("aria-label")).toBe("Actions");
  });

  it("FindBar is a named NON-modal dialog (editor stays live behind it)", () => {
    const dialogs = dialogsIn(
      renderToStaticMarkup(<FindBar editor={stubEditor} onClose={noop} />),
    );

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute("aria-modal")).toBe("false");
    expect(dialogs[0].getAttribute("aria-label")).toBe("Find in note");
  });

  it("puts the dialog on the panel, not on the full-viewport scrim", () => {
    const markup = renderToStaticMarkup(
      <ActionPanel actions={[]} onClose={noop} />,
    );
    const scrim = parse(markup).firstElementChild;

    expect(scrim?.getAttribute("role")).toBeNull();
    expect(scrim?.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
