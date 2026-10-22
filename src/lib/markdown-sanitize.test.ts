import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions } from "./editor-extensions";
import { sanitizeDoc } from "./markdown-sanitize";

function open(markdown: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
}

/** Each text node with the hrefs of its link marks, in document order. */
function linkRuns(editor: Editor): [string, string[]][] {
  const runs: [string, string[]][] = [];
  editor.state.doc.descendants((n) => {
    if (n.isText) {
      runs.push([
        n.text!,
        n.marks.filter((m) => m.type.name === "link").map((m) => m.attrs.href as string),
      ]);
    }
  });
  return runs;
}

describe("sanitizeDoc, the same mark twice on one text", () => {
  it("keeps one bold when it is doubled", () => {
    const out = sanitizeDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] }],
        },
      ],
    });
    expect(out.content![0].content![0].marks).toEqual([{ type: "bold" }]);
  });
});

describe("nested links (ADR 0017: a text holds one link, the innermost wins)", () => {
  const note = "[a [b](https://in.example) c](https://out.example)";

  it("keeps the inner href on the inner text and the outer href on the rest", () => {
    const editor = open(note);
    expect(linkRuns(editor)).toEqual([
      ["a ", ["https://out.example"]],
      ["b", ["https://in.example"]],
      [" c", ["https://out.example"]],
    ]);
    editor.destroy();
  });

  it("writes every href back, so none is lost on save", () => {
    const editor = open(note);
    const saved = editor.getMarkdown();
    editor.destroy();
    expect(saved).toContain("https://in.example");
    expect(saved).toContain("https://out.example");
    expect(saved).toContain("[b](https://in.example)");
  });

  it("keeps an inner autolink inside an outer link", () => {
    const editor = open("[a <https://auto.example> c](https://out.example)");
    expect(linkRuns(editor).map(([, hrefs]) => hrefs)).toEqual([
      ["https://out.example"],
      ["https://auto.example"],
      ["https://out.example"],
    ]);
    editor.destroy();
  });
});
