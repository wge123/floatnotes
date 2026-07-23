import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";

let editor: Editor;

/**
 * SearchAndReplace is excluded HERE ONLY: under vitest (not production —
 * verified live) the plugin's direct "prosemirror-view" import loads a
 * second module instance (ESM/CJS dual-package hazard), whose foreign
 * DecorationSet crashes prosemirror-view on empty docs — and these tests
 * must start from an empty doc to simulate typing. It contributes nothing
 * to input-rule behavior.
 */
function createEditor(content = ""): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions().filter(
      (e) => e.name !== "searchAndReplace",
    ),
    content,
  });
  return editor;
}

afterEach(() => editor?.destroy());

/**
 * Simulate real typing: input rules hook handleTextInput, which
 * insertContent/setContent never trigger.
 */
function type(ed: Editor, text: string): void {
  for (const ch of text) {
    const handled = ed.view.someProp("handleTextInput", (f) =>
      // 5th param (insert-default) exists in this prosemirror-view's type but
      // is unused by input rules; a no-op keeps the call honest.
      f(ed.view, ed.state.selection.from, ed.state.selection.to, ch, () =>
        ed.state.tr.insertText(ch),
      ),
    );
    if (!handled) {
      ed.view.dispatch(ed.state.tr.insertText(ch));
    }
  }
}

describe("typing todos (Raycast parity)", () => {
  it("'- [ ] ' becomes an unchecked task item", () => {
    const ed = createEditor();
    type(ed, "- [ ] buy milk");
    const doc = ed.getJSON();
    expect(doc.content?.[0]?.type).toBe("taskList");
    expect(doc.content?.[0]?.content?.[0]?.attrs?.checked).toBe(false);
    expect(serializeMarkdown(ed)).toBe("- [ ] buy milk");
  });

  it("'- [x] ' becomes a checked task item", () => {
    const ed = createEditor();
    type(ed, "- [x] done thing");
    const doc = ed.getJSON();
    expect(doc.content?.[0]?.type).toBe("taskList");
    expect(doc.content?.[0]?.content?.[0]?.attrs?.checked).toBe(true);
    expect(serializeMarkdown(ed)).toBe("- [x] done thing");
  });

  it("'[] ' shorthand works inside a bullet too", () => {
    const ed = createEditor();
    type(ed, "- [] quick");
    expect(ed.getJSON().content?.[0]?.type).toBe("taskList");
  });

  it("brackets mid-sentence stay literal text", () => {
    const ed = createEditor();
    type(ed, "- see [ ] brackets");
    expect(ed.getJSON().content?.[0]?.type).toBe("bulletList");
  });

  it("plain-paragraph '[ ] ' still becomes a task item (TaskItem's own rule)", () => {
    const ed = createEditor();
    type(ed, "[ ] standalone");
    expect(ed.getJSON().content?.[0]?.type).toBe("taskList");
  });
});
