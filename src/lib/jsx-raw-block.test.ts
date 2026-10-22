import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, saveNote } from "./editor-extensions";

function load(markdown: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
}

function roundTrip(markdown: string): string {
  const editor = load(markdown);
  const out = saveNote(editor);
  editor.destroy();
  return out;
}

// Docs pages saved from MDX sites wrap indented content in component tags. The
// stock HTML block ends at the first blank line, so the content after it read
// as indented code. The whole element, up to its matching closing tag, is one
// raw block instead (ADR 0018).
const TABS = [
  "# Agents",
  "",
  "<Tabs>",
  '  <Tab title="One">',
  "    ```bash",
  "    run one",
  "    ```",
  "",
  "    Or through the plugin system:",
  "",
  "    ```bash",
  "    plugin add x",
  "    ```",
  "",
  "    Installs the `x` plugin and an MCP server.",
  "  </Tab>",
  "",
  '  <Tab title="Two">',
  "    ```bash",
  "    run two",
  "    ```",
  "  </Tab>",
  "</Tabs>",
  "",
  "After the tabs.",
].join("\n");

describe("component tags with indented content", () => {
  it("keeps the whole element, blank lines and indented content included", () => {
    expect(roundTrip(TABS)).toBe(TABS);
  });

  it("holds it as one raw block, with the text after it as a paragraph", () => {
    const editor = load(TABS);
    const kinds = editor.getJSON().content!.map((n) => n.type);
    expect(kinds).toEqual(["heading", "rawBlock", "paragraph"]);
    expect(editor.getJSON().content![1].attrs!.value).toContain(
      "Installs the `x` plugin and an MCP server.",
    );
  });

  it("settles after one save", () => {
    const once = roundTrip(TABS);
    expect(roundTrip(once)).toBe(once);
  });

  it("pairs nested tags of the same name", () => {
    const note = "<Box>\n\n  <Box>\n\n    inner\n\n  </Box>\n\n  outer text\n\n</Box>\n\nafter";
    const editor = load(note);
    expect(editor.getJSON().content!.map((n) => n.type)).toEqual(["rawBlock", "paragraph"]);
    expect(saveNote(editor)).toBe(note);
  });

  it("leaves a tag with no closing tag to the stock HTML block", () => {
    const note = "<Open>\n\nlater text";
    expect(roundTrip(note)).toBe(note);
  });

  it("does not look inside a code fence", () => {
    const note = "```\n<Tabs>\n\n  indented\n\n</Tabs>\n```";
    const editor = load(note);
    expect(editor.getJSON().content!.map((n) => n.type)).toEqual(["codeBlock"]);
    expect(saveNote(editor)).toBe(note);
  });
});
