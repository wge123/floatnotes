import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";

let editor: Editor;

/**
 * SearchAndReplace is excluded HERE ONLY, for the same reason as
 * task-input-rule.test.ts: under vitest its direct "prosemirror-view" import
 * loads a second module instance (ESM/CJS dual-package hazard) whose foreign
 * DecorationSet crashes on empty nodes — and an empty task item is precisely
 * an empty node. Verified unaffected in the real app.
 */
function roundTrip(markdown: string): string {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions().filter(
      (e) => e.name !== "searchAndReplace",
    ),
    content: markdown,
  });
  return serializeMarkdown(editor);
}

function firstNodeType(markdown: string): string {
  roundTrip(markdown);
  return editor.getJSON().content?.[0]?.type ?? "";
}

afterEach(() => editor?.destroy());

describe("empty task items survive a round-trip", () => {
  it.each([
    ["- [ ] ", "- [ ] "],
    ["- [x] ", "- [x] "],
    // No trailing space on disk — normalises to the canonical form.
    ["- [ ]", "- [ ] "],
    ["- [X]", "- [x] "],
  ])("round-trips %j", (source, expected) => {
    expect(roundTrip(source)).toBe(expected);
  });

  it("parses an empty task as a task item, not a bullet", () => {
    expect(firstNodeType("- [ ] ")).toBe("taskList");
  });

  /**
   * The actual damage the bug did. A bullet holding the literal text `[ ]`
   * serialises with the brackets escaped, so the item can never be recognised
   * as a task again — the note is silently corrupted by its own save.
   */
  it("never emits escaped brackets for an empty task", () => {
    const out = roundTrip("- [ ] ");
    expect(out).not.toContain("\\[");
    expect(out).not.toContain("\\]");
  });

  it("is idempotent across repeated saves", () => {
    const once = roundTrip("- [ ] ");
    editor.destroy();
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps checked state through the round-trip", () => {
    roundTrip("- [x] ");
    const task = editor.getJSON().content?.[0]?.content?.[0];
    expect(task?.attrs?.checked).toBe(true);
  });
});

describe("the empty-task rule does not over-reach", () => {
  it("leaves non-empty tasks exactly as they were", () => {
    expect(roundTrip("- [ ] real content")).toBe("- [ ] real content");
  });

  it("leaves a bare bracket paragraph alone — only list items are tasks", () => {
    expect(firstNodeType("[ ]")).toBe("paragraph");
  });

  it("does not convert a bullet whose text merely resembles a checkbox", () => {
    // `[ x ]` is not checkbox syntax; it must stay a plain bullet.
    expect(firstNodeType("- [ x ]")).toBe("bulletList");
  });
});
