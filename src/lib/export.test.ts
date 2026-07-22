import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions } from "./editor-extensions";
import { toHtml, toPlainText } from "./export";

/** Same headless-editor pattern as markdown-roundtrip.test.ts. */
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

const SOURCE = "# Title\n\nSome **bold** text.\n\n- one\n- two";

describe("toPlainText", () => {
  it("strips markdown markers and keeps the prose", () => {
    const text = withEditor(SOURCE, toPlainText);
    expect(text).toContain("Title");
    expect(text).toContain("Some bold text.");
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
  });

  it("separates blocks with blank lines", () => {
    const text = withEditor("# A\n\nB", toPlainText);
    expect(text).toBe("A\n\nB");
  });
});

describe("toHtml", () => {
  it("renders markdown constructs as tags", () => {
    const html = withEditor(SOURCE, toHtml);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>");
  });
});
