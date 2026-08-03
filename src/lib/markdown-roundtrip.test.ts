import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";

function createEditor(content = ""): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
  });
}

/** Parse markdown into the editor, serialize it back out. */
function roundTrip(markdown: string): string {
  const editor = createEditor(markdown);
  const out = serializeMarkdown(editor);
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

  it("serializes edits made through editor commands as markdown", () => {
    const editor = createEditor("plain");
    editor.commands.selectAll();
    editor.commands.toggleBold();
    expect(serializeMarkdown(editor)).toBe("**plain**");
    editor.destroy();
  });
});

const TABLE = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");

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
  // Every other block serializes without a trailing newline, so this is not a
  // typo: tiptap-markdown's table serializer calls ensureNewLine() after the
  // last row and getMarkdown() never trims. Asserted rather than papered over,
  // because it is the shape that actually reaches the .md file (ADR 0013).
  it("round-trips a minimal table, plus a trailing newline", () => {
    expect(roundTrip(TABLE)).toBe(`${TABLE}\n`);
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
    expect(roundTrip(source)).toBe(`${source}\n`);
  });

  // The serializer skips renderInline when a cell's text is blank, so an empty
  // cell emits nothing between its pipes rather than collapsing the column.
  it("keeps an empty cell as an empty column", () => {
    const source = ["| a | b |", "| --- | --- |", "|  | 2 |"].join("\n");
    expect(roundTrip(source)).toBe(`${source}\n`);
  });

  it("opens a blank line between a table and the paragraph above it", () => {
    expect(roundTrip(`intro\n${TABLE}`)).toBe(`intro\n\n${TABLE}\n`);
  });

  it("round-trips a table indented inside a list item", () => {
    const source = [
      "- item",
      "",
      "  | a | b |",
      "  | --- | --- |",
      "  | 1 | 2 |",
    ].join("\n");
    expect(roundTrip(source)).toBe(`${source}\n`);
  });

  // ADR 0013: the UI cannot produce colspan, but pasted HTML can. Markdown has
  // no pipe syntax for it, so tiptap-markdown's HTML fallback is the honest
  // answer here (html:true, per ADR 0005). Locked in so the fallback can never
  // start swallowing tables the UI *did* produce without a test noticing.
  it("leaves pasted colspan HTML as HTML instead of mangling it", () => {
    const html =
      '<table><tbody><tr><td colspan="2">wide</td></tr>' +
      "<tr><td>a</td><td>b</td></tr></tbody></table>";
    const out = roundTrip(html);
    expect(out).toContain("<table");
    expect(out).toContain('colspan="2"');
    expect(out).not.toContain("| wide |");
  });

  // The one keystroke that used to turn a good table into an HTML blob: Enter
  // split a cell's paragraph in two, and a two-block cell is not
  // pipe-serializable. The keymap swallows it inside a cell (ADR 0013).
  it("Enter inside a cell is a no-op, so the table stays pipe markdown", () => {
    const editor = createEditor(TABLE);
    caretAfter(editor, "1");
    expect(editor.isActive("tableCell")).toBe(true);

    pressKey(editor, "Enter");
    editor.commands.insertContent("x");

    const out = serializeMarkdown(editor);
    expect(out).not.toContain("<table");
    expect(out).toBe("| a | b |\n| --- | --- |\n| 1x | 2 |\n");
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

    expect(serializeMarkdown(editor)).toBe("one\n\ntwo");
    editor.destroy();
  });
});
