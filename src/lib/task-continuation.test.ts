import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, saveNote } from "./editor-extensions";

function roundTrip(markdown: string): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  const out = saveNote(editor);
  editor.destroy();
  return out;
}

// A task item's wrapped lines stay part of the item (ADR 0017). Shapes taken
// from real notes: continuation lines indented to the text after `- [ ] `,
// with code spans and bold that run across the line break.
describe("task item continuation lines", () => {
  it("keeps wrapped lines, with a code span on the last, inside the item", () => {
    const note =
      "- [ ] Clone `owner/repo` (MIT, 1M+ rows across\n" +
      "      Greenhouse / Lever / Ashby). A data source, not an app.\n" +
      "      `gh repo clone owner/repo ~/dir`\n" +
      "- [ ] Skim another feed";
    expect(roundTrip(note)).toBe(note);
  });

  it("keeps bold that runs across the line break", () => {
    const note =
      "- [ ] `pkg@x` and no payload; **check you recognise\n" +
      "      this one before removing** and no usage signal\n" +
      "- [ ] next";
    expect(roundTrip(note)).toBe(note);
  });

  it("keeps a wrapped line that starts with bold or a parenthesis", () => {
    const note =
      "- [ ] Right-click the strip, choose **New Space**\n" +
      "      (or menu bar: **Spaces** then **New Space**)\n" +
      "- [ ] Name it exactly `Personal`";
    expect(roundTrip(note)).toBe(note);
  });

  it("reads a continuation indented only two spaces as the same item text", () => {
    const out = roundTrip("- [ ] one\n  more line\n- [ ] two");
    expect(out).toBe("- [ ] one\n      more line\n- [ ] two");
  });

  it("keeps a continuation under a nested task, and the nested task itself", () => {
    const out = roundTrip(
      "- [ ] one\n  more line\n  - [ ] nested\n    cont of nested\n- [ ] two",
    );
    expect(out).toBe(
      "- [ ] one\n      more line\n  - [ ] nested\n        cont of nested\n- [ ] two",
    );
  });

  it("settles after one save", () => {
    const once = roundTrip(
      "- [ ] one\n  more line\n  - [ ] nested\n    cont of nested\n- [ ] two",
    );
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps a paragraph after a blank line as its own paragraph", () => {
    const note = "- [ ] one\n\n  para two\n- [ ] two";
    expect(roundTrip(note)).toBe(note);
  });

  // Real notes end a task line with a lone backslash and a blank line. At the
  // end of a block that backslash is a plain character, not a break, and it is
  // saved as typed instead of doubled.
  it("saves a trailing backslash on a task line as it was written", () => {
    const note = "- [x] F1. tooltip readable\\\n\n  Notes:\n- [ ] next";
    expect(roundTrip(note)).toBe(note);
  });

  it("reads a whitespace-only line after the backslash like an empty one", () => {
    expect(roundTrip("- [x] F1. readable\\\n  \n  Notes:\n- [ ] next")).toBe(
      "- [x] F1. readable\\\n\n  Notes:\n- [ ] next",
    );
  });
});
