import { describe, expect, it } from "vitest";

import { originalRaw } from "./tokenizer-raw";
import { buildEditorExtensions, loadNote, saveNote } from "./editor-extensions";
import { Editor } from "@tiptap/core";

const lines = ["1. a", "2. b", "after", "more"];

describe("originalRaw: the unmodified source of the lines a tokenizer consumed", () => {
  it("counts lines when the token's raw has no trailing newline", () => {
    expect(originalRaw(lines, "1. a\n2. b")).toBe("1. a\n2. b");
  });

  it("counts the same lines when the token's raw ends in a newline", () => {
    // Stock task lists end raw with "\n"; the line after must not be taken.
    expect(originalRaw(lines, "1. a\n2. b\n")).toBe("1. a\n2. b\n");
  });

  it("takes a single line", () => {
    expect(originalRaw(lines, "1. a")).toBe("1. a");
    expect(originalRaw(lines, "1. a\n")).toBe("1. a\n");
  });
});

function roundTrip(note: string): string {
  const { content } = loadNote(note);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  const out = saveNote(editor);
  editor.destroy();
  return out;
}

describe("lists followed by other blocks", () => {
  it("an ordered list does not swallow the paragraph after it", () => {
    const note = "1. a\n2. b\n\nafter";
    expect(roundTrip(note)).toBe(note);
  });

  it("an ordered list with nested content keeps the paragraph after it", () => {
    const note = "1. a\n   - x\n2. b\n\nafter\n\nlast";
    expect(roundTrip(note)).toBe(note);
  });

  it("a task list does not swallow the paragraph after it", () => {
    // A bare `- [ ]` is saved with its trailing space; the rest is unchanged.
    expect(roundTrip("- [ ]\n- [x] b\n\nafter")).toBe("- [ ] \n- [x] b\n\nafter");
  });
});
