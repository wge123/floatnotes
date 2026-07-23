import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";
import {
  FORMAT_COMMANDS,
  headingCommand,
  inAnyHeading,
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
