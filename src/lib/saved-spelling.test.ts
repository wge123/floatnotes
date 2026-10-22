import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildEditorExtensions, saveNote } from "./editor-extensions";

function createEditor(content = ""): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
}

function roundTrip(markdown: string): string {
  const editor = createEditor(markdown);
  const out = saveNote(editor);
  editor.destroy();
  return out;
}

describe("saves keep today's spelling", () => {
  it.each([
    "[[Note]]",
    "[[folder/Note|alias]]",
    "see [[Another note]] and [[b]] here",
  ])("keeps wikilink %j without backslashes", (source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it.each(["snake_case_word", "file_name.md", "a_b and c_d_e"])(
    "keeps %j without \\_",
    (source) => {
      expect(roundTrip(source)).toBe(source);
    },
  );

  it("keeps real emphasis, and escapes that change the meaning", () => {
    // Emphasis is still emphasis (its delimiter is written as `*`, as in v2).
    expect(roundTrip("some _emphasis_ here")).toBe("some *emphasis* here");
    expect(roundTrip("\\*not italic\\*")).toBe("\\*not italic\\*");
    expect(roundTrip("\\_not italic\\_")).toBe("\\_not italic\\_");
    expect(roundTrip("a \\[link\\](x) b")).toBe("a \\[link\\](x) b");
  });

  it("converges after one save when escapes are cleaned", () => {
    for (const source of ["a_b \\*c\\* [[d]]", "x \\_y\\_ z_w"]) {
      const once = roundTrip(source);
      expect(roundTrip(once)).toBe(once);
    }
  });

  it("writes underline as <u> and loads ++x++ as underline", () => {
    expect(roundTrip("a <u>word</u> b")).toBe("a <u>word</u> b");
    const ed = createEditor("a ++word++ b");
    expect(saveNote(ed)).toBe("a <u>word</u> b");
    ed.destroy();
  });

  it.each([
    ["<https://example.com>", "<https://example.com>"],
    ["https://example.com", "<https://example.com>"],
    ["[https://example.com](https://example.com)", "<https://example.com>"],
    ["[site](https://example.com)", "[site](https://example.com)"],
    [
      "[**https://example.com**](https://example.com)",
      "[**https://example.com**](https://example.com)",
    ],
  ])("spells link %j as %j", (source, expected) => {
    expect(roundTrip(source)).toBe(expected);
  });
});
