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
    expect((doc.content?.[0]?.content?.[0] as { attrs?: { checked?: boolean } } | undefined)?.attrs?.checked).toBe(false);
    expect(saveNote(ed)).toBe("- [ ] buy milk");
  });

  it("'- [x] ' becomes a checked task item", () => {
    const ed = createEditor();
    type(ed, "- [x] done thing");
    const doc = ed.getJSON();
    expect(doc.content?.[0]?.type).toBe("taskList");
    expect((doc.content?.[0]?.content?.[0] as { attrs?: { checked?: boolean } } | undefined)?.attrs?.checked).toBe(true);
    expect(saveNote(ed)).toBe("- [x] done thing");
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

  function pressEnter(ed: Editor): void {
    const ev = new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true });
    const handled = ed.view.someProp("handleKeyDown", (f) => f(ed.view, ev));
    expect(handled).toBe(true);
  }

  it("'[x] ' at the start of a new task item checks it, not nested", () => {
    const ed = createEditor();
    type(ed, "- [ ] a");
    pressEnter(ed);
    type(ed, "[x] b");
    const list = ed.getJSON().content?.[0];
    expect(list?.type).toBe("taskList");
    expect(list?.content?.length).toBe(2);
    expect((list?.content?.[1] as { attrs?: { checked?: boolean } }).attrs?.checked).toBe(true);
    expect(saveNote(ed)).toBe("- [ ] a\n- [x] b");
  });

  it("'[ ] ' at the start of a new task item leaves it unchecked and consumes the marker", () => {
    const ed = createEditor();
    type(ed, "- [x] a");
    pressEnter(ed);
    type(ed, "[ ] b");
    expect(saveNote(ed)).toBe("- [x] a\n- [ ] b");
  });

  it("'[x] ' then '[ ] ' retypes the same item without nesting", () => {
    const ed = createEditor();
    type(ed, "- [ ] a");
    pressEnter(ed);
    type(ed, "[x] ");
    type(ed, "[ ] b");
    expect(saveNote(ed)).toBe("- [ ] a\n- [ ] b");
  });
});
