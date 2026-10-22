import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { afterEach, describe, expect, it } from "vitest";

import { Search } from "./search-extension";

let editor: Editor;

function make(content: string): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, Search],
    content,
  });
  return editor;
}

afterEach(() => editor?.destroy());

const storage = () =>
  (editor.storage as unknown as { search: unknown }).search as {
    results: { from: number; to: number }[];
    resultIndex: number;
  };

const classes = (cls: string) =>
  editor.view.dom.querySelectorAll(`.${cls}`).length;

describe("search extension", () => {
  it("finds every match, case-insensitively, across a mark boundary", () => {
    make("<p>Foo bar foo <strong>fo</strong>o</p>");
    editor.commands.setSearchTerm("foo");
    expect(storage().results).toHaveLength(3);
    expect(storage().resultIndex).toBe(0);
  });

  it("decorates every match and marks only the current one distinctly", () => {
    make("<p>foo bar foo baz foo</p>");
    editor.commands.setSearchTerm("foo");
    expect(classes("search-result")).toBe(3);
    expect(classes("search-result-current")).toBe(1);
    editor.commands.nextSearchResult();
    expect(storage().resultIndex).toBe(1);
    const current = editor.view.dom.querySelector(".search-result-current")!;
    expect(current.textContent).toBe("foo");
    const all = [...editor.view.dom.querySelectorAll(".search-result")];
    expect(all.indexOf(current)).toBe(1);
  });

  it("wraps around in both directions", () => {
    make("<p>foo foo foo</p>");
    editor.commands.setSearchTerm("foo");
    editor.commands.previousSearchResult();
    expect(storage().resultIndex).toBe(2);
    editor.commands.nextSearchResult();
    expect(storage().resultIndex).toBe(0);
  });

  it("resetIndex returns to the first match", () => {
    make("<p>foo foo foo</p>");
    editor.commands.setSearchTerm("foo");
    editor.commands.nextSearchResult();
    editor.commands.resetIndex();
    expect(storage().resultIndex).toBe(0);
  });

  it("clears matches and decorations on an empty term", () => {
    make("<p>foo</p>");
    editor.commands.setSearchTerm("foo");
    editor.commands.setSearchTerm("");
    expect(storage().results).toHaveLength(0);
    expect(classes("search-result")).toBe(0);
  });

  it("recomputes when the document changes", () => {
    make("<p>foo</p>");
    editor.commands.setSearchTerm("foo");
    editor.commands.insertContentAt(1, "foo ");
    expect(storage().results).toHaveLength(2);
  });

  it("does not crash on an empty note alongside a placeholder", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: "x" }),
        Search,
      ],
      content: "",
    });
    editor.commands.setSearchTerm("foo");
    editor.commands.nextSearchResult();
    expect(storage().results).toHaveLength(0);
    expect(classes("search-result")).toBe(0);
  });
});
