import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, saveNote } from "./editor-extensions";

let editor: Editor;

function createEditor(content = ""): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  return editor;
}

afterEach(() => editor?.destroy());

/** Drive a paste the way ProseMirror does: through the handlePaste prop. */
function paste(ed: Editor, data: { text?: string; html?: string }): boolean {
  const clipboardData = {
    getData: (type: string) =>
      type === "text/plain" ? (data.text ?? "") : type === "text/html" ? (data.html ?? "") : "",
    types: [
      ...(data.text !== undefined ? ["text/plain"] : []),
      ...(data.html !== undefined ? ["text/html"] : []),
    ],
  };
  const event = { clipboardData, preventDefault() {} } as unknown as ClipboardEvent;
  const slice = ed.state.doc.slice(0, 0);
  return !!ed.view.someProp("handlePaste", (f) => f(ed.view, event, slice));
}

describe("pasting markdown text", () => {
  it("turns **bold** into bold, not literal markers", () => {
    const ed = createEditor();
    expect(paste(ed, { text: "**bold**" })).toBe(true);
    expect(ed.getHTML()).toContain("<strong>bold</strong>");
    expect(saveNote(ed)).toBe("**bold**");
  });

  it("turns a dash list into a bullet list", () => {
    const ed = createEditor();
    paste(ed, { text: "- a\n- b" });
    expect(ed.getJSON().content?.[0]?.type).toBe("bulletList");
    expect(saveNote(ed)).toBe("- a\n- b");
  });

  it("turns # Title into a heading", () => {
    const ed = createEditor();
    paste(ed, { text: "# Title" });
    expect(ed.getJSON().content?.[0]?.type).toBe("heading");
  });

  it("turns - [ ] into a task", () => {
    const ed = createEditor();
    paste(ed, { text: "- [ ] buy milk" });
    expect(ed.getJSON().content?.[0]?.type).toBe("taskList");
  });

  it("merges inline markdown into the current paragraph", () => {
    const ed = createEditor("hello world");
    ed.commands.setTextSelection(7);
    paste(ed, { text: "**big** " });
    expect(saveNote(ed)).toBe("hello **big** world");
  });

  it("keeps plain text and its line breaks unchanged", () => {
    const ed = createEditor();
    paste(ed, { text: "line one\nline two" });
    expect(saveNote(ed)).toBe("line one\nline two");
    expect(ed.getJSON().content).toHaveLength(1);
  });

  it("leaves HTML paste to ProseMirror", () => {
    const ed = createEditor();
    expect(paste(ed, { text: "**x**", html: "<p><b>x</b></p>" })).toBe(false);
  });

  it("leaves a paste into a code block literal", () => {
    const ed = createEditor("```\n\n```");
    ed.commands.setTextSelection(2);
    expect(paste(ed, { text: "**x**" })).toBe(false);
  });
});
