import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";
import { markerSpecs } from "./reveal-markers";

/** Same headless-editor pattern as export.test.ts / markdown-roundtrip.test.ts. */
function withEditor<T>(markdown: string, fn: (editor: Editor) => T): T {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: markdown,
  });
  try {
    return fn(editor);
  } finally {
    editor.destroy();
  }
}

/** Put a collapsed caret at `pos` and read back what would be revealed. */
function specsAt(editor: Editor, pos: number) {
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  return markerSpecs(editor.state);
}

/** First position inside the text of the first text block. */
function textStart(editor: Editor) {
  return editor.state.doc.resolve(1).start();
}

/** Caret position at the `n`th character of the first text block's text. */
function at(editor: Editor, n: number) {
  return textStart(editor) + n;
}

describe("markerSpecs", () => {
  it("reveals nothing when the caret is in plain text", () => {
    withEditor("just prose here", (editor) => {
      expect(specsAt(editor, at(editor, 4))).toEqual([]);
    });
  });

  it("reveals ** around the bold run the caret sits inside", () => {
    withEditor("a **bold** b", (editor) => {
      // Rendered text is "a bold b", so offset 4 is inside "bold".
      const specs = specsAt(editor, at(editor, 4));
      expect(specs.map((s) => s.text)).toEqual(["**", "**"]);
      expect(specs.map((s) => s.side)).toEqual(["open", "close"]);
      // Markers bracket the run, not the whole paragraph.
      expect(specs[1].pos - specs[0].pos).toBe("bold".length);
    });
  });

  it("stops revealing once the caret leaves the run", () => {
    withEditor("a **bold** b", (editor) => {
      expect(specsAt(editor, at(editor, 4))).not.toEqual([]);
      // Offset 0 is before "a", well outside the bold run.
      expect(specsAt(editor, at(editor, 0))).toEqual([]);
    });
  });

  it("uses the marker the serializer actually writes, per mark type", () => {
    const cases: Array<[string, string]> = [
      ["a *it* b", "*"],
      ["a `code` b", "`"],
      ["a ~~gone~~ b", "~~"],
    ];
    for (const [src, marker] of cases) {
      withEditor(src, (editor) => {
        const specs = specsAt(editor, at(editor, 3));
        expect(specs.map((s) => s.text)).toEqual([marker, marker]);
      });
    }
  });

  it("reveals both markers for nested marks", () => {
    withEditor("***both***", (editor) => {
      const texts = specsAt(editor, at(editor, 2))
        .map((s) => s.text)
        .sort();
      expect(texts).toEqual(["*", "*", "**", "**"]);
    });
  });

  it("reveals the # prefix inside a heading, scaled to its level", () => {
    withEditor("### Title", (editor) => {
      const specs = specsAt(editor, at(editor, 2));
      expect(specs).toHaveLength(1);
      expect(specs[0].text).toBe("### ");
      expect(specs[0].pos).toBe(textStart(editor));
    });
  });

  it("reveals heading prefix and inline marker together", () => {
    withEditor("# A **b** c", (editor) => {
      const texts = specsAt(editor, at(editor, 3)).map((s) => s.text);
      expect(texts).toContain("# ");
      expect(texts.filter((t) => t === "**")).toHaveLength(2);
    });
  });

  it("reveals nothing while a range is selected", () => {
    withEditor("a **bold** b", (editor) => {
      const { state, view } = editor;
      const from = at(editor, 2);
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, from, from + 4)),
      );
      expect(markerSpecs(editor.state)).toEqual([]);
    });
  });

  it("brackets only the run the caret is in when a paragraph has two", () => {
    withEditor("**one** plain **two**", (editor) => {
      // Rendered text is "one plain two"; offset 11 is inside "two".
      const specs = specsAt(editor, at(editor, 11));
      expect(specs).toHaveLength(2);
      // The opener must sit after "one plain ", not at the paragraph start.
      expect(specs[0].pos).toBeGreaterThan(textStart(editor) + "one plain".length);
      expect(specs[1].pos - specs[0].pos).toBe("two".length);
    });
  });
});

describe("the plugin is actually wired into the editor", () => {
  // markerSpecs being right proves nothing about whether buildEditorExtensions
  // installs the plugin. These mount a real view and read the DOM, so a
  // regression that drops RevealMarkers from the extension list fails here
  // rather than shipping a feature that computes correctly and renders nothing.
  function mounted<T>(markdown: string, fn: (editor: Editor, el: HTMLElement) => T): T {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: buildEditorExtensions(),
      content: markdown,
    });
    try {
      return fn(editor, el);
    } finally {
      editor.destroy();
      el.remove();
    }
  }

  it("renders marker spans when the caret enters styled text", () => {
    mounted("a **bold** b", (editor, el) => {
      expect(el.querySelectorAll(".reveal-marker")).toHaveLength(0);
      const { state, view } = editor;
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, at(editor, 4))),
      );
      const spans = el.querySelectorAll(".reveal-marker");
      expect(spans).toHaveLength(2);
      expect([...spans].map((s) => s.textContent)).toEqual(["**", "**"]);
    });
  });

  it("marks the spans uneditable and hidden from assistive tech", () => {
    mounted("a **bold** b", (editor, el) => {
      const { state, view } = editor;
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, at(editor, 4))),
      );
      const span = el.querySelector(".reveal-marker");
      // Without contenteditable=false the caret would walk into characters the
      // document does not contain; without aria-hidden a screen reader would
      // announce syntax as prose.
      expect(span?.getAttribute("contenteditable")).toBe("false");
      expect(span?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("removes the spans again when the caret leaves", () => {
    mounted("a **bold** b", (editor, el) => {
      const { view } = editor;
      view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, at(editor, 4)),
        ),
      );
      expect(el.querySelectorAll(".reveal-marker")).toHaveLength(2);
      view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, at(editor, 0)),
        ),
      );
      expect(el.querySelectorAll(".reveal-marker")).toHaveLength(0);
    });
  });
});

describe("the document is untouched", () => {
  // The whole safety argument for this feature is that markers are decorations,
  // never content. If a caret move could change getMarkdown(), the watcher would
  // write marker characters into the user's note file.
  it("serializes identically with the caret inside styled text", () => {
    withEditor("a **bold** b\n", (editor) => {
      const before = serializeMarkdown(editor);
      specsAt(editor, at(editor, 4));
      expect(markerSpecs(editor.state)).not.toEqual([]);
      expect(serializeMarkdown(editor)).toBe(before);
    });
  });

  it("serializes identically inside a heading", () => {
    withEditor("## Title\n", (editor) => {
      const before = serializeMarkdown(editor);
      specsAt(editor, at(editor, 3));
      expect(markerSpecs(editor.state)).not.toEqual([]);
      expect(serializeMarkdown(editor)).toBe(before);
    });
  });

  it("leaves the doc unchanged across a full caret sweep", () => {
    withEditor("# H\n\na **b** `c` ~~d~~ e\n", (editor) => {
      const before = serializeMarkdown(editor);
      const size = editor.state.doc.content.size;
      for (let pos = 1; pos < size; pos++) {
        try {
          specsAt(editor, pos);
        } catch {
          // Not every position resolves to a valid text selection; those are
          // simply not places a caret can be.
        }
      }
      expect(serializeMarkdown(editor)).toBe(before);
    });
  });
});
