import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  buildEditorExtensions,
  loadNote,
  saveNote,
} from "./editor-extensions";

function createEditor(content = ""): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
}

/** Parse markdown into the editor, serialize it back out. */
function roundTrip(markdown: string): string {
  const { frontMatter, content } = loadNote(markdown);
  const editor = createEditor(content);
  const out = saveNote(editor, frontMatter);
  editor.destroy();
  return out;
}

describe("markdown round-trip", () => {
  it("is idempotent for a document using every supported construct", () => {
    const source = [
      "# Title",
      "",
      "Some **bold** and *italic* and `code` and ~~struck~~ text.",
      "",
      "## Section",
      "",
      "> a quote",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "```",
      "code block",
      "```",
      "",
      "---",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "[link](https://example.com)",
    ].join("\n");

    const once = roundTrip(source);
    const twice = roundTrip(once);
    expect(twice).toBe(once);
  });

  it.each([
    ["# Title", "# Title"],
    ["**bold**", "**bold**"],
    ["- [ ] task", "- [ ] task"],
    ["- one\n- two", "- one\n- two"],
    ["> quote", "> quote"],
  ])("preserves %j exactly", (source, expected) => {
    expect(roundTrip(source)).toBe(expected);
  });

  // A save used to delete these outright: there was no Image node, and the
  // heading levels stopped at 3, so #### parsed as a plain paragraph.
  it.each([
    ["![alt](pic.png)", "![alt](pic.png)"],
    ['![alt](pic.png "Tip")', '![alt](pic.png "Tip")'],
    ["#### H4", "#### H4"],
    ["##### H5", "##### H5"],
    ["###### H6", "###### H6"],
  ])("keeps %j instead of dropping it", (source, expected) => {
    expect(roundTrip(source)).toBe(expected);
  });

  // Inline, or ProseMirror splits the paragraph around a block image and the
  // save turns one line into three.
  it("keeps an image inside its sentence", () => {
    const source = "Image ![alt](pic.png) here.";
    expect(roundTrip(source)).toBe(source);
  });

  it("serializes edits made through editor commands as markdown", () => {
    const editor = createEditor("plain");
    editor.commands.selectAll();
    editor.commands.toggleBold();
    expect(saveNote(editor)).toBe("**plain**");
    editor.destroy();
  });
});

const TABLE = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");

/**
 * TipTap 3 pads every cell to its column's width, so the same table is spelled
 * with different runs of spaces and dashes (an accepted restyle). Shape tests
 * compare the table with that padding squeezed out.
 */
const squeeze = (md: string) =>
  md.replace(/ +$/gm, "").replace(/ +/g, " ").replace(/-{3,}/g, "---");

/** Press a key through the editor's real ProseMirror keymap chain. */
function pressKey(editor: Editor, key: string): void {
  editor.view.someProp("handleKeyDown", (handler) =>
    handler(editor.view, new KeyboardEvent("keydown", { key })),
  );
}

/**
 * Put the caret directly after the given text. Positions inside a table have
 * to be found, not counted: an offset that lands on a cell boundary rather
 * than inside its paragraph is still a legal selection, and edits there append
 * a sibling block instead of typing into the cell.
 */
function caretAfter(editor: Editor, text: string): void {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (pos === -1 && node.isText && node.text === text) pos = at + text.length;
  });
  if (pos === -1) throw new Error(`no text node "${text}" in the document`);
  editor.commands.setTextSelection(pos);
}

describe("markdown tables", () => {
  // TipTap 3 pads cells to the column width; NoteTable trims the newlines the
  // stock serializer wraps around a table, so a final table adds no newline.
  it("round-trips a minimal table, padded to the column width", () => {
    expect(roundTrip(TABLE)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    );
  });

  it("is idempotent", () => {
    const once = roundTrip(TABLE);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps inline marks inside cells", () => {
    const source = [
      "| **bold** | `code` |",
      "| --- | --- |",
      "| [link](https://example.com) | ~~struck~~ |",
    ].join("\n");
    expect(squeeze(roundTrip(source))).toBe(squeeze(source));
  });

  // The serializer skips renderInline when a cell's text is blank, so an empty
  // cell emits nothing between its pipes rather than collapsing the column.
  it("keeps an empty cell as an empty column", () => {
    const source = ["| a | b |", "| --- | --- |", "|  | 2 |"].join("\n");
    expect(squeeze(roundTrip(source))).toBe(squeeze(source));
  });

  it("opens a blank line between a table and the paragraph above it", () => {
    expect(squeeze(roundTrip(`intro\n${TABLE}`))).toBe(`intro\n\n${TABLE}`);
  });

  it("round-trips a table indented inside a list item", () => {
    const source = [
      "- item",
      "",
      "  | a | b |",
      "  | --- | --- |",
      "  | 1 | 2 |",
    ].join("\n");
    expect(squeeze(roundTrip(source))).toBe(squeeze(source));
  });

  // ADR 0013: the UI cannot produce colspan, but pasted HTML can. Markdown has
  // no pipe syntax for it, so keeping the HTML is the honest answer
  // here (ADR 0005). Locked in so the fallback can never
  // start swallowing tables the UI *did* produce without a test noticing.
  //
  // it.fails: TipTap 3 parses the table and flattens the colspan into pipe
  // syntax (text kept, merged cell lost) instead of keeping the HTML. Raw HTML
  // blocks are ticket 07's (todo f9134a04); flip this back to `it` there.
  it("leaves pasted colspan HTML as HTML instead of mangling it", () => {
    const html =
      '<table><tbody><tr><td colspan="2">wide</td></tr>' +
      "<tr><td>a</td><td>b</td></tr></tbody></table>";
    const out = roundTrip(html);
    expect(out).toContain("<table");
    expect(out).toContain('colspan="2"');
    expect(out).not.toContain("| wide |");
  });

  // Enter used to split a cell's paragraph in two, and a two-block cell is not
  // pipe-serializable. ADR 0019: Enter now moves to the cell below in the same
  // column and does nothing in the last row. Cells stay single-line.
  it("Enter in a cell moves the caret to the cell below, same column", () => {
    const editor = createEditor(TABLE);
    caretAfter(editor, "b");

    pressKey(editor, "Enter");
    editor.commands.insertContent("x");

    const out = saveNote(editor);
    expect(out).not.toContain("<table");
    expect(squeeze(out)).toBe("| a | b |\n| --- | --- |\n| 1 | 2x |");
    editor.destroy();
  });

  it("Enter in the last row does nothing", () => {
    const editor = createEditor(TABLE);
    caretAfter(editor, "1");
    expect(editor.isActive("tableCell")).toBe(true);

    pressKey(editor, "Enter");
    editor.commands.insertContent("x");

    const out = saveNote(editor);
    expect(out).not.toContain("<table");
    expect(squeeze(out)).toBe("| a | b |\n| --- | --- |\n| 1x | 2 |");
    editor.destroy();
  });

  // Control for the test above: the same keypress outside a table must still
  // split the block, or the assertion above would pass on a dead keymap.
  it("Enter outside a table still splits the block", () => {
    const editor = createEditor("one");
    caretAfter(editor, "one");
    expect(editor.isActive("tableCell")).toBe(false);

    pressKey(editor, "Enter");
    editor.commands.insertContent("two");

    expect(saveNote(editor)).toBe("one\n\ntwo");
    editor.destroy();
  });
});
