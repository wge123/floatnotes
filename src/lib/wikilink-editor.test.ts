import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { buildEditorExtensions, saveNote } from "./editor-extensions";

function createEditor(content: string, onWikilink: (t: string) => void): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions("", onWikilink),
    content,
    contentType: "markdown",
  });
}

function click(editor: Editor, el: Element, mods: MouseEventInit) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }));
  return editor;
}

describe("wikilink decoration and click", () => {
  const source = "see [[Deep note|alias]] and `[[code]]` here";

  it("marks the wikilink span and leaves the saved markdown unchanged", () => {
    const editor = createEditor(source, () => {});
    const spans = editor.view.dom.querySelectorAll("span.wikilink");
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("[[Deep note|alias]]");
    expect(saveNote(editor)).toBe(source);
    editor.destroy();
  });

  it("opens with the target on Cmd-click and Ctrl-click, not on a plain click", () => {
    const onOpen = vi.fn();
    const editor = createEditor(source, onOpen);
    const span = editor.view.dom.querySelector("span.wikilink")!;
    click(editor, span, {});
    expect(onOpen).not.toHaveBeenCalled();
    click(editor, span, { metaKey: true });
    click(editor, span, { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith("Deep note|alias");
    editor.destroy();
  });
});
