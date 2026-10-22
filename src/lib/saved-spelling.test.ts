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

  // A reference definition `[x]: url` makes marked read the inner `[x]` of
  // `[[x]]` as a link. Wikilinks are literal text whatever the note defines.
  it.each([
    ["[[x]]\n\n[x]: https://example.com", "[[x]]"],
    ["see [[x]] and [[y]] here\n\n[x]: https://x.example\n[y]: https://y.example", "see [[x]] and [[y]] here"],
    ["[[folder/Note|alias]]\n\n[folder/Note|alias]: https://e.com", "[[folder/Note|alias]]"],
    ["[[x]] and [x] and [[x]]\n\n[x]: https://example.com", "[[x]] and [x](https://example.com) and [[x]]"],
  ])("keeps the wikilink in %j literal even with a matching definition", (source, expected) => {
    const out = roundTrip(source);
    expect(out).toContain(expected);
    expect(out).not.toContain("\\[");
    expect(out).not.toContain("[[x](");
  });

  it("still reads `[[1]](url)` as a link whose text is `[1]`", () => {
    expect(roundTrip("see [[1]](https://e.com) here")).toBe("see [[1]](https://e.com) here");
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

  // `++` in prose is not underline: the stock tokenizer paired the two `++` of
  // "CAM++ (a) ... CAM++ (b)" and trimmed the space inside, changing the text.
  // A pair opens only before a non-space, not right after a letter or digit,
  // and closes only after a non-space.
  it.each([
    "CAM++ (a, ~7.2M) x. then CAM++ (b)",
    "C++, Java and C++",
    "x ++ y ++ z",
    "i++ and j++",
  ])("leaves ++ in prose alone: %j", (source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it("keeps ++ for underlined text that <u> would read back as raw HTML", () => {
    // `<u>` content is raw HTML on load, so an escape inside it would come
    // back as a literal backslash and grow on every save.
    const starred = roundTrip("x ++snake_case and *star*++ y");
    expect(starred).toContain("++");
    expect(roundTrip(starred)).toBe(starred);
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
