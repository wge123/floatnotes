import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, loadNote, saveNote } from "./editor-extensions";

/**
 * Raw blocks (ADR 0018, glossary): HTML, comments and footnotes the editor
 * has no node for are kept as read-only atoms and saved byte for byte.
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

function nodeNames(): string[] {
  const names: string[] = [];
  editor.state.doc.descendants((n) => {
    names.push(n.type.name);
  });
  return names;
}

function rawNames(): string[] {
  return nodeNames().filter((n) => n.startsWith("raw"));
}

afterEach(() => editor?.destroy());

const DETAILS = [
  "<details>",
  "<summary>Click to expand</summary>",
  "",
  "Hidden **markdown** inside details.",
  "",
  "</details>",
].join("\n");

describe("block HTML (stories 5, 7)", () => {
  it("keeps a details block byte for byte after an edit elsewhere", () => {
    const note = `# Title\n\n${DETAILS}\n\nTail`;
    open(note);
    // Type at the end of the heading.
    editor.chain().insertContentAt(1 + "Title".length, "!").run();
    expect(saveNote(editor)).toBe(note.replace("# Title", "# Title!"));
  });

  it("keeps div and img HTML", () => {
    const note = '<div align="center">\n<img src="d.png" width="300">\n</div>';
    expect(save(note)).toBe(note);
  });

  it("keeps center/a/img wrappers", () => {
    const note = '<center><a href="https://x.y"><img src="a.png"></a></center>';
    expect(save(note)).toBe(note);
  });

  it("keeps JSX such as a Card", () => {
    const note = '<Card href="https://x.y/z">\nBody text\n</Card>';
    expect(save(note)).toBe(note);
  });

  it("keeps an HTML table as HTML", () => {
    const note = "<table>\n<tr><td>a</td></tr>\n</table>";
    expect(save(note)).toBe(note);
  });

  it("keeps raw HTML inside a list item", () => {
    const note = "- item\n\n  <div>x</div>";
    expect(save(note)).toContain("<div>x</div>");
  });
});

describe("comments (story 6)", () => {
  it("keeps a leading comment and leaves no empty paragraph", () => {
    const note = "<!-- lint-disable -->\n\n# Title\n\nBody";
    expect(save(note)).toBe(note);
    const empties = editor.state.doc.content.content.filter(
      (n) => n.type.name === "paragraph" && n.content.size === 0,
    );
    expect(empties).toHaveLength(0);
  });

  it("keeps a multi-line block comment", () => {
    const note = "Intro\n\n<!--\nline one\nline two\n-->\n\nOutro";
    expect(save(note)).toBe(note);
  });

  it("keeps an inline comment and unknown inline tags", () => {
    const note = "Press <kbd>Cmd</kbd> now <!-- why --> done";
    expect(save(note)).toBe(note);
    expect(nodeNames()).toContain("rawInline");
  });

  it("keeps a trailing comment", () => {
    const note = "Body\n\n<!-- a comment that should survive -->";
    expect(save(note)).toBe(note);
  });
});

describe("footnotes (story 7)", () => {
  it("keeps references literally and definitions as raw blocks", () => {
    const note =
      "Claim[^1] and more[^note].\n\n[^1]: The source.\n\n[^note]: Longer one\n    that continues.";
    expect(save(note)).toBe(note);
    expect(nodeNames()).toContain("rawBlock");
  });

  it("does not turn a reference into a link", () => {
    open("See[^1].\n\n[^1]: Source");
    expect(JSON.stringify(editor.getJSON())).not.toContain('"link"');
  });
});

describe("what stays code", () => {
  it("does not read HTML inside a fenced block as a raw block", () => {
    const note = "```html\n<div>\n<!-- c -->\n</div>\n```";
    expect(save(note)).toBe(note);
    expect(rawNames()).toEqual([]);
  });

  it("does not read HTML inside a code span as raw", () => {
    const note = "Use `<kbd>` and `<!-- x -->` here";
    expect(save(note)).toBe(note);
    expect(rawNames()).toEqual([]);
  });

  it("leaves autolinks alone", () => {
    open("Mail <a@b.co> or <https://example.com/x>");
    expect(rawNames()).toEqual([]);
  });

  it("still turns <br> into a hard break, not a raw atom", () => {
    open("one<br>two");
    expect(nodeNames()).toContain("hardBreak");
    expect(rawNames()).toEqual([]);
  });
});

describe("read-only and whole-block handling (stories 8, 9)", () => {
  it("renders the original text in a non-editable element", () => {
    open("<div>hi</div>\n\nafter");
    const el = editor.view.dom.querySelector("[data-raw-block]");
    expect(el?.getAttribute("contenteditable")).toBe("false");
    expect(el?.textContent).toBe("<div>hi</div>");
  });

  it("ignores typing while the block is selected", () => {
    open("<div>hi</div>\n\nafter");
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    );
    const handled = editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, 0, 1, "x"),
    );
    expect(handled).toBe(true);
    expect(saveNote(editor)).toBe("<div>hi</div>\n\nafter");
  });

  it("selects and deletes a block as a whole", () => {
    open("before\n\n<div>hi</div>\n\nafter");
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "rawBlock") pos = p;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
    );
    editor.commands.deleteSelection();
    expect(saveNote(editor)).toBe("before\n\nafter");
  });

  it("is an atom that can be dragged as a whole", () => {
    open("<div>hi</div>");
    expect(editor.schema.nodes.rawBlock.spec.draggable).toBe(true);
    expect(editor.schema.nodes.rawBlock.isAtom).toBe(true);
  });

  it("leaves a place to put the caret after a final block", async () => {
    open("before\n\n<div>hi</div>");
    // The trailing paragraph is appended on the editor's create tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    const end = editor.state.doc.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end - 1)),
    );
    expect(editor.state.selection.empty).toBe(true);
  });
});

describe("converges", () => {
  it("is stable on a second save", () => {
    const note = `<!-- c -->\n\n# T\n\n${DETAILS}\n\nText <kbd>k</kbd>[^1]\n\n[^1]: def`;
    const once = save(note);
    editor.destroy();
    expect(save(once)).toBe(once);
  });
});
