import { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import {
  buildEditorExtensions,
  loadNote,
  saveNote,
} from "./editor-extensions";
import type { FrontMatter } from "./front-matter";

/**
 * Pins what a save writes today for notes shaped like the ones in ~/Notes, so
 * the TipTap 3 upgrade (todo f9134a04) shows every change to a note's bytes as
 * a reviewable diff in __fixtures__/notes/__saved__ instead of a silent
 * rewrite. The pinned files record CURRENT behaviour, drift included: a
 * snapshot that differs from its source is not a bug report, and updating one
 * (`vitest -u`) is a decision to accept the new bytes.
 *
 * The fixtures are synthetic. Each one exercises constructs counted in real
 * notes (front matter, `*` bullets, `__bold__`, raw HTML, reference links,
 * hard breaks, no final newline), never copied note content.
 */

// Vite's raw glob rather than node:fs, as in focus-affordances.test.tsx: the
// repo has no @types/node. One level only, so __saved__ is not collected.
const fixtures = import.meta.glob("./__fixtures__/notes/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const cases = Object.entries(fixtures)
  .map(([path, source]) => [path.split("/").pop() as string, source] as const)
  .sort(([a], [b]) => a.localeCompare(b));

/** Load a whole note text, front matter included, through the note pair. */
function createEditor(note: string): {
  editor: Editor;
  frontMatter: FrontMatter | null;
} {
  const { frontMatter, content } = loadNote(note);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  return { editor, frontMatter };
}

function save(note: string): string {
  const { editor, frontMatter } = createEditor(note);
  const out = saveNote(editor, frontMatter);
  editor.destroy();
  return out;
}

/**
 * Notes whose saved bytes change again on the next save, today:
 * - list-markers: a `*` list and the `-` list after it both save as `-`, so
 *   they re-parse as one loose list and gain blank lines.
 */
const KEEPS_CHANGING = new Set(["list-markers.md"]);

describe.each(cases)("saving %s", (name, source) => {
  it("writes the pinned bytes", async () => {
    await expect(save(source)).toMatchFileSnapshot(
      `./__fixtures__/notes/__saved__/${name}`,
    );
  });

  // Serialization never validates the schema, so a doc the parser built wrong
  // would still save; check it explicitly.
  it("parses into a schema-valid document", () => {
    const { editor } = createEditor(source);
    expect(() => editor.state.doc.check()).not.toThrow();
    editor.destroy();
  });

  // it.fails, not it, for the notes a save keeps rewriting: it goes red the
  // day one starts converging, so the fix flips it rather than nobody noticing.
  (KEEPS_CHANGING.has(name) ? it.fails : it)("converges after one save", () => {
    const once = save(source);
    expect(save(once)).toBe(once);
  });

  // A real edit goes through a transaction; an untouched load does not. Type a
  // character and take it back so the doc is identical, and the bytes must be.
  it("writes the same bytes after an edit that is undone", () => {
    const { editor, frontMatter } = createEditor(source);
    const untouched = saveNote(editor, frontMatter);
    // Inside the last textblock: content.size is past the last block, where
    // an insert opens a new paragraph instead of typing. (Not
    // Selection.atEnd: a note ending in a raw block has no textblock at its
    // end, and atEnd would land before the atom.)
    let end = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock) end = pos + node.nodeSize - 1;
    });
    editor.chain().insertContentAt(end, "x").run();
    editor.chain().deleteRange({ from: end, to: end + 1 }).run();
    expect(saveNote(editor, frontMatter)).toBe(untouched);
    editor.destroy();
  });
});

// Checked in as LF (git would normalise a CRLF fixture), so built here: one
// real note uses CRLF and the save decides what its line endings become.
it("pins what a save does to CRLF line endings", () => {
  const out = save("# Title\r\n\r\nline one\r\nline two\r\n");
  expect(JSON.stringify(out)).toMatchInlineSnapshot(`""# Title\\n\\nline one\\nline two""`);
});

// ADR 0018: front matter is split off before the editor sees the note and
// written back unchanged, so an edit in the body never touches it.
describe("front matter", () => {
  const fm = "---\ntitle: Weekly review\ntags: [review, weekly]\n---\n\n";

  it("stays byte for byte after an edit in the body", () => {
    const { editor, frontMatter } = createEditor(`${fm}# Hi\n\nbody`);
    const end = Selection.atEnd(editor.state.doc).from;
    editor.chain().insertContentAt(end, "!").run();
    expect(saveNote(editor, frontMatter)).toBe(`${fm}# Hi\n\nbody!`);
    editor.destroy();
  });

  it("is never shown to the editor as body text", () => {
    const { editor } = createEditor(`${fm}# Hi`);
    expect(editor.getText()).toBe("Hi");
    editor.destroy();
  });

  it("keeps a CRLF note's front matter exactly", () => {
    const note = "---\r\na: 1\r\n---\r\n\r\nbody";
    expect(save(note)).toBe(note);
  });

  it("keeps a front-matter-only note", () => {
    expect(save("---\na: 1\n---\n")).toBe("---\na: 1\n---\n");
    expect(save("---\na: 1\n---")).toBe("---\na: 1\n---");
  });

  it("treats a later horizontal rule as body, not front matter", () => {
    expect(loadNote("# Title\n\n---\n\ntext\n---\n").frontMatter).toBeNull();
    expect(save("# Title\n\n---\n\ntext")).toBe("# Title\n\n---\n\ntext");
  });

  it("is not front matter without a closing fence", () => {
    expect(loadNote("---\ntitle: x\n\nbody").frontMatter).toBeNull();
    expect(loadNote("---").frontMatter).toBeNull();
  });

  it("is not front matter when the fence line has other text", () => {
    expect(loadNote("--- \na: 1\n---\n").frontMatter).toBeNull();
    expect(loadNote("----\na: 1\n---\n").frontMatter).toBeNull();
    expect(loadNote("\n---\na: 1\n---\n").frontMatter).toBeNull();
  });

  it("saves a note without front matter as before", () => {
    expect(loadNote("# Plain\n\ntext").frontMatter).toBeNull();
    expect(save("# Plain\n\ntext")).toBe("# Plain\n\ntext");
  });

  it("exposes the raw YAML for editing", () => {
    expect(loadNote(`${fm}body`).frontMatter?.yaml).toBe(
      "title: Weekly review\ntags: [review, weekly]",
    );
  });
});
