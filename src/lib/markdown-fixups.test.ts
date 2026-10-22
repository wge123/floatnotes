import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, loadNote, saveNote } from "./editor-extensions";

/**
 * Notes the TipTap 3 markdown extension corrupts out of the box, each found by
 * the corpus check against real notes (todo 041962f5). The TipTap 2 editor
 * kept all of them.
 */
let editor: Editor;

function roundTrip(note: string): string {
  const { frontMatter, content } = loadNote(note);
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  return saveNote(editor, frontMatter);
}

afterEach(() => editor?.destroy());

describe("a linked image (README badge)", () => {
  const badge = "[![PyPI](https://img.example/p.svg)](https://pypi.example/p/)";

  it("keeps the link around the image", () => {
    expect(roundTrip(badge)).toBe(badge);
  });

  it("keeps a row of badges, and converges", () => {
    const row = `${badge}\n[![Py](https://img.example/q.svg)](https://pypi.example/q/)`;
    const once = roundTrip(row);
    expect(once).toBe(row);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps the link when the badge is written as HTML", () => {
    expect(
      roundTrip('<a href="https://pypi.example/p/"><img src="https://img.example/p.svg" alt="PyPI"></a>'),
    ).toBe(badge);
  });
});

describe("a hard break", () => {
  it("is not turned into a stray backslash when it ends a paragraph", () => {
    const once = roundTrip("one<br/>\n\ntwo");
    expect(once).toBe("one\n\ntwo");
    expect(roundTrip(once)).toBe(once);
  });

  it("is kept as a backslash break, so two in a row survive", () => {
    const note = "first\\\n\\\nsecond";
    expect(roundTrip(note)).toBe(note);
  });
});

describe("a multi-line setext heading", () => {
  it("stays one heading line instead of spilling into the next paragraph", () => {
    const once = roundTrip("title line\nsecond line\n--\n\nbody");
    expect(once).toBe("## title line second line\n\nbody");
    expect(roundTrip(once)).toBe(once);
  });
});

describe("text after a code fence inside a list item", () => {
  it("is parsed as inline markdown, not kept as raw text", () => {
    const out = roundTrip("- item\n  ```sh\n  ls\n  ```\n  then run `ls -h` [here].\n- next");
    expect(out).toContain("then run `ls -h`");
    expect(out).not.toContain("\\`");
    expect(roundTrip(out)).toBe(out);
  });

  it("builds a schema-valid document", () => {
    roundTrip("- item\n  ```sh\n  ls\n  ```\n  then run `ls`\n- next");
    expect(() => editor.state.doc.check()).not.toThrow();
  });
});
