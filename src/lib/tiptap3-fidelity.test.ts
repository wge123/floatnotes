import { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, loadNote, saveNote } from "./editor-extensions";

/**
 * What the TipTap 3 move (todo f9134a04, ADR 0019) buys: line breaks, table
 * alignment and escaped pipes survive, and the click target below a final
 * block is never saved unless the user typed in it.
 */
let editor: Editor;

function open(note: string): Editor {
  const { content } = loadNote(note);
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  return editor;
}

function save(note: string): string {
  open(note);
  return saveNote(editor);
}

afterEach(() => editor?.destroy());

describe("soft line breaks (story 10)", () => {
  it("keeps a hard-wrapped paragraph's newline in the file", () => {
    expect(save("line one\nline two")).toBe("line one\nline two");
  });

  it("keeps a hard-wrapped quote's newline in the file", () => {
    expect(save("> quoted one\n> quoted two")).toBe("> quoted one\n> quoted two");
  });
});

describe("tables (stories 15, 16)", () => {
  it("keeps an escaped pipe inside a cell, and converges", () => {
    const once = save("| a | b |\n| --- | --- |\n| x \\| y | 2 |\n");
    expect(once).toContain("x \\| y");
    expect(save(once)).toBe(once);
  });

  it("keeps column alignment", () => {
    const out = save("| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n");
    const sep = out.split("\n")[1];
    expect(sep).toMatch(/^\|\s*:-+\s*\|\s*:-+:\s*\|\s*-+:\s*\|$/);
  });
});

describe("the empty spot after a final block (stories 27-29)", () => {
  const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  it("gives a final table a paragraph to click into", () => {
    open(TABLE);
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
  });

  it("does not save that paragraph while it is untouched", () => {
    open(TABLE);
    const out = saveNote(editor);
    expect(out.trimEnd()).toBe(TABLE);
    expect(out).not.toMatch(/\n\n$/);
  });

  it("saves it once the user types in it", () => {
    open(TABLE);
    const end = Selection.atEnd(editor.state.doc).from;
    editor.chain().insertContentAt(end, "after").run();
    expect(saveNote(editor)).toMatch(/\| 1 {1,}\| 2 {1,}\|\n+after$/);
  });

  it("keeps a note without a final newline in that shape", () => {
    expect(save("para")).toBe("para");
    expect(save("```\ncode\n```")).toBe("```\ncode\n```");
  });
});
