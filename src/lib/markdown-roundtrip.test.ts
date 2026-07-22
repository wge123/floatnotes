import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";

function createEditor(content = ""): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
  });
}

/** Parse markdown into the editor, serialize it back out. */
function roundTrip(markdown: string): string {
  const editor = createEditor(markdown);
  const out = serializeMarkdown(editor);
  editor.destroy();
  return out;
}

describe("markdown round-trip", () => {
  it("is idempotent for a document using every supported construct", () => {
    const source = [
      "# Title",
      "",
      "Some **bold** and *italic* and `code` and ~~struck~~ text.",
      "",
      "## Section",
      "",
      "> a quote",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "```",
      "code block",
      "```",
      "",
      "---",
      "",
      "[link](https://example.com)",
    ].join("\n");

    const once = roundTrip(source);
    const twice = roundTrip(once);
    expect(twice).toBe(once);
  });

  it.each([
    ["# Title", "# Title"],
    ["**bold**", "**bold**"],
    ["- [ ] task", "- [ ] task"],
    ["- one\n- two", "- one\n- two"],
    ["> quote", "> quote"],
  ])("preserves %j exactly", (source, expected) => {
    expect(roundTrip(source)).toBe(expected);
  });

  it("serializes edits made through editor commands as markdown", () => {
    const editor = createEditor("plain");
    editor.commands.selectAll();
    editor.commands.toggleBold();
    expect(serializeMarkdown(editor)).toBe("**plain**");
    editor.destroy();
  });
});
