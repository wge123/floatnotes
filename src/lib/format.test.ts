import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";
import {
  FORMAT_COMMANDS,
  headingCommand,
  inAnyHeading,
  insertTable,
  NEW_TABLE_SIZE,
  toggleLink,
} from "./format";

let editor: Editor;

function createEditor(content = ""): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
  });
  return editor;
}

afterEach(() => editor?.destroy());

function command(id: string) {
  const found = FORMAT_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`no format command "${id}"`);
  return found;
}

describe("FORMAT_COMMANDS", () => {
  it("every command round-trips: run toggles on, isActive reports it, run toggles off", () => {
    for (const cmd of FORMAT_COMMANDS) {
      const ed = createEditor("word");
      ed.commands.setTextSelection({ from: 1, to: 5 });
      expect(cmd.isActive(ed), `${cmd.id} initially off`).toBe(false);
      cmd.run(ed);
      expect(cmd.isActive(ed), `${cmd.id} on after run`).toBe(true);
      cmd.run(ed);
      expect(cmd.isActive(ed), `${cmd.id} off after second run`).toBe(false);
      ed.destroy();
    }
  });

  it("bold serializes to markdown", () => {
    const ed = createEditor("word");
    ed.commands.setTextSelection({ from: 1, to: 5 });
    command("bold").run(ed);
    expect(serializeMarkdown(ed)).toBe("**word**");
  });

  // Regression: ⌘A yields an AllSelection, from which the lift-based toggles
  // (blockquote + the three lists) wrapped but wouldn't un-wrap. liftableChain
  // coerces it to a text selection so the second run lifts back out.
  it("lift-based commands toggle off even under a select-all (AllSelection)", () => {
    for (const id of ["blockquote", "ordered-list", "bullet-list", "task-list"]) {
      const cmd = command(id);
      const ed = createEditor("word");
      ed.commands.selectAll();
      cmd.run(ed);
      expect(cmd.isActive(ed), `${id} on after first run`).toBe(true);
      ed.commands.selectAll();
      cmd.run(ed);
      expect(cmd.isActive(ed), `${id} off after second run`).toBe(false);
      ed.destroy();
    }
  });

  // Regression: markdown has no underline syntax; with Markdown html:false the
  // mark was silently dropped on save. html:true round-trips it as <u>.
  it("underline round-trips through markdown as <u>", () => {
    const ed = createEditor("word");
    ed.commands.setTextSelection({ from: 1, to: 5 });
    command("underline").run(ed);
    expect(serializeMarkdown(ed)).toContain("<u>word</u>");
    const reloaded = createEditor(serializeMarkdown(ed));
    expect(reloaded.isActive("underline")).toBe(true);
  });
});

describe("headings", () => {
  it("toggleHeading sets the level and inAnyHeading lights up", () => {
    const ed = createEditor("word");
    expect(inAnyHeading(ed)).toBe(false);
    headingCommand(2).run(ed);
    expect(headingCommand(2).isActive(ed)).toBe(true);
    expect(headingCommand(1).isActive(ed)).toBe(false);
    expect(inAnyHeading(ed)).toBe(true);
    expect(serializeMarkdown(ed)).toBe("## word");
  });
});

describe("insertTable", () => {
  // The whole point of ADR 0013. tiptap-markdown refuses pipe syntax when the
  // first row holds a plain cell and silently writes a raw <table> blob into
  // the .md file instead, so a header row is not a default here, it is the
  // invariant.
  it("inserts a header-first table that serializes as pipe markdown", () => {
    const ed = createEditor("intro");
    insertTable(ed);

    const md = serializeMarkdown(ed);
    expect(md).not.toContain("<table");
    const [firstRow, delimiter] = md.split("\n");
    expect(firstRow).toBe("|  |  |  |");
    expect(delimiter).toBe("| --- | --- | --- |");
  });

  it("inserts the configured number of rows and columns", () => {
    const ed = createEditor("intro");
    insertTable(ed);

    const rows = serializeMarkdown(ed)
      .split("\n")
      .filter((line) => line.startsWith("|"));
    // Header + delimiter + the remaining body rows.
    expect(rows).toHaveLength(NEW_TABLE_SIZE.rows + 1);
    expect(rows[0].split("|")).toHaveLength(NEW_TABLE_SIZE.cols + 2);
  });

  it("leaves the caret inside the new table", () => {
    const ed = createEditor("intro");
    insertTable(ed);
    expect(ed.isActive("table")).toBe(true);
  });
});

describe("toggleLink", () => {
  it("sets a link from the prompted URL", () => {
    const ed = createEditor("word");
    ed.commands.setTextSelection({ from: 1, to: 5 });
    toggleLink(ed, () => "https://example.com");
    expect(ed.isActive("link")).toBe(true);
    expect(serializeMarkdown(ed)).toBe("[word](https://example.com)");
  });

  it("removes an active link without prompting", () => {
    const ed = createEditor("[word](https://example.com)");
    ed.commands.setTextSelection({ from: 1, to: 5 });
    let prompted = false;
    toggleLink(ed, () => {
      prompted = true;
      return null;
    });
    expect(prompted).toBe(false);
    expect(ed.isActive("link")).toBe(false);
  });

  it("cancelled or empty prompt is a no-op", () => {
    const ed = createEditor("word");
    ed.commands.setTextSelection({ from: 1, to: 5 });
    toggleLink(ed, () => null);
    toggleLink(ed, () => "   ");
    expect(ed.isActive("link")).toBe(false);
  });
});
