import { Editor, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, saveNote } from "./editor-extensions";

function fromMarkdown(markdown: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
}

function roundTrip(markdown: string): string {
  const editor = fromMarkdown(markdown);
  const out = saveNote(editor);
  editor.destroy();
  return out;
}

/** An editor holding `text` typed as plain text in one paragraph. */
function typed(text: string): Editor {
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: doc,
  });
}

function reload(markdown: string): Editor {
  return fromMarkdown(markdown);
}

describe("plain-text symbols are saved as typed", () => {
  it.each([
    "a -> b",
    "fish & chips",
    "under <15 minutes",
    "x > y and y < z",
    "5 < 6 and 7 > 3",
    "A -> B & C <15 > D",
    "R&D, AT&T and a&b",
    "# A & B",
    "- [ ] move X -> Y & Z",
    "> quoted -> text & more",
  ])("keeps %j byte for byte", (source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it("writes an entity the note spelled out as the character it stands for", () => {
    expect(roundTrip("Tom &amp; Jerry, 1 &lt; 2")).toBe("Tom & Jerry, 1 < 2");
  });

  it("keeps symbols in a table cell as typed", () => {
    const out = roundTrip("| a | b |\n| --- | --- |\n| x -> y | p & q |");
    expect(out).toContain("x -> y");
    expect(out).toContain("p & q");
    expect(out).not.toMatch(/&amp;|&gt;|&lt;/);
  });

  it("keeps a link whose text and address hold an ampersand", () => {
    const note = "[A & B](https://x.test/?a=1&b=2)";
    expect(roundTrip(note)).toBe(note);
  });
});

describe("a symbol that would be read as markup is escaped, and only that", () => {
  it("escapes text that looks like an entity, so it reloads as the same text", () => {
    const editor = typed("use &amp; for an ampersand");
    const saved = saveNote(editor);
    expect(saved).toBe("use \\&amp; for an ampersand");
    expect(reload(saved).getText()).toBe("use &amp; for an ampersand");
  });

  it.each([
    ["call List<String> here", "call List\\<String> here"],
    ["<b>bold</b> typed", "\\<b>bold\\</b> typed"],
    ["<!-- not a comment -->", "\\<!-- not a comment -->"],
    ["see <https://example.com> now", "see \\<https://example.com> now"],
  ])("escapes tag-looking text %j so it stays text on reload", (text, expected) => {
    const saved = saveNote(typed(text));
    expect(saved).toBe(expected);
    const back = reload(saved);
    expect(back.getText()).toBe(text);
    let raw = 0;
    back.state.doc.descendants((n) => {
      if (n.type.name.startsWith("raw")) raw++;
    });
    expect(raw).toBe(0);
    expect(saveNote(back)).toBe(saved);
  });

  it("escapes a greater-than that would start a quote, but not one inside a line", () => {
    expect(saveNote(typed("> not a quote"))).toBe("\\> not a quote");
    expect(saveNote(typed("a > b"))).toBe("a > b");
  });

  it("keeps a typed less-than that is followed by a space or digit unescaped", () => {
    expect(saveNote(typed("1 < 2 and <15 and a <- b"))).toBe("1 < 2 and <15 and a <- b");
  });
});

describe("code and raw blocks are written exactly", () => {
  it.each([
    "```\na -> b & c <d> &amp; e\n```",
    "inline `x<y && y>z &amp;` code",
    "<details>\n<summary>S &amp; T</summary>\n\nbody -> text\n</details>",
    "text <kbd>Ctrl</kbd> and &amp; entity inside raw tags",
  ])("keeps %j", (source) => {
    expect(roundTrip(source)).toBe(source);
  });
});
