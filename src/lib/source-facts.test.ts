import { describe, expect, it } from "vitest";

import { classifyNote, type NoteFacts } from "./corpus-classify";
import { sourceFacts, type SourceFacts } from "./source-facts";

describe("sourceFacts", () => {
  it("reads visible words with markup, escapes and entities resolved", () => {
    const f = sourceFacts("Some **bold** and `code` A &amp; B \\* c_d\n\n# Head\n\n- one\n- two");
    expect(f.words).toEqual([
      "Some", "bold", "and", "code", "A", "&", "B", "*", "c_d", "Head", "one", "two",
    ]);
  });

  it("joins words that markup splits mid-word, and splits at soft and hard breaks", () => {
    expect(sourceFacts("un**believ**able").words).toEqual(["unbelievable"]);
    expect(sourceFacts("a  \nb").words).toEqual(["a", "b"]);
    expect(sourceFacts("a  \nb").hardBreaks).toBe(1);
  });

  it("reads table cells and task items", () => {
    const f = sourceFacts("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] todo");
    expect(f.words).toEqual(["a", "b", "1", "2", "todo"]);
  });

  it("collects link hrefs: inline, reference, angle and bare", () => {
    const f = sourceFacts(
      "[a](https://one.example) [b][r] <https://two.example> https://three.example\n\n[r]: https://ref.example",
    );
    expect(f.links.sort()).toEqual([
      "https://one.example",
      "https://ref.example",
      "https://three.example",
      "https://two.example",
    ]);
    expect(f.unusedDefs).toEqual([]);
  });

  it("collects image srcs", () => {
    expect(sourceFacts("![alt](a.png) and [![b](b.png)](https://x.example)").images.sort()).toEqual([
      "a.png",
      "b.png",
    ]);
  });

  it("keeps HTML blocks, inline HTML and comments verbatim, not whitespace-collapsed", () => {
    const f = sourceFacts(
      "<!-- note  here -->\n\n<div>\n  hi   there\n</div>\n\ntext <kbd>k</kbd> end",
    );
    expect(f.rawSources).toEqual([
      "<!-- note  here -->",
      "<div>\n  hi   there\n</div>",
      "<kbd>",
      "</kbd>",
    ]);
    expect(f.words).toEqual(["text", "k", "end"]);
  });

  it("leaves <br> and <u>, which the editor owns, out of the raw sources", () => {
    const f = sourceFacts("a<br>b <u>x</u>");
    expect(f.rawSources).toEqual([]);
    expect(f.hardBreaks).toBe(1);
    expect(f.words).toEqual(["a", "b", "x"]);
  });

  it("does not read HTML inside a fenced block or a code span as HTML", () => {
    const f = sourceFacts("```html\n<b>x</b>\n```\n\n`<i>`");
    expect(f.rawSources).toEqual([]);
    expect(f.words).toEqual(["<b>x</b>", "<i>"]);
  });

  it("keeps footnote definitions verbatim and reports unused reference definitions", () => {
    const f = sourceFacts("text[^1]\n\n[^1]: the  note\n\n[orphan]: https://orphan.example");
    expect(f.rawSources).toEqual(["[^1]: the  note"]);
    expect(f.unusedDefs).toEqual(["https://orphan.example"]);
  });

  it("splits front matter off before reading the body", () => {
    const f = sourceFacts("---\ntitle: x\n---\nbody");
    expect(f.frontMatter).toBe("---\ntitle: x\n---\n");
    expect(f.words).toEqual(["body"]);
  });
});

const editorFacts: NoteFacts = {
  text: "same",
  links: [],
  images: [],
  hardBreaks: 0,
  frontMatter: null,
};
const base: SourceFacts = {
  words: ["a", "b"],
  links: ["https://x.example"],
  images: [],
  rawSources: [],
  hardBreaks: 0,
  unusedDefs: [],
  frontMatter: null,
};
const run = (before: SourceFacts, after: SourceFacts) =>
  classifyNote({
    original: "a",
    saved: "b",
    resaved: "b",
    before: editorFacts,
    after: editorFacts,
    sourceBefore: before,
    sourceAfter: after,
  });

describe("classifyNote with source facts", () => {
  it("is a restyle when the source facts match", () => {
    expect(run(base, base).class).toBe("restyle");
  });

  it("calls a lost word content lost even when the editor facts agree", () => {
    const r = run(base, { ...base, words: ["a"] });
    expect(r.class).toBe("content lost");
    expect(r.reasons.join()).toMatch(/source text differs/);
  });

  it("calls a lost link, image, break or unused definition content lost", () => {
    expect(run(base, { ...base, links: [] }).reasons.join()).toMatch(/source links differ/);
    expect(run({ ...base, images: ["p.png"] }, base).reasons.join()).toMatch(/source images differ/);
    expect(run({ ...base, hardBreaks: 1 }, base).reasons.join()).toMatch(/source line breaks differ/);
    expect(run({ ...base, unusedDefs: ["https://o.example"] }, base).reasons.join()).toMatch(
      /unused definitions/,
    );
  });

  it("compares raw sources exactly, so collapsed whitespace is a loss", () => {
    const r = run(
      { ...base, rawSources: ["<div>\n  hi   there\n</div>"] },
      { ...base, rawSources: ["<div>\n hi there\n</div>"] },
    );
    expect(r.class).toBe("content lost");
    expect(r.reasons.join()).toMatch(/raw HTML/);
  });

  it("compares raw sources as a multiset", () => {
    const r = run(
      { ...base, rawSources: ["<a>", "<b>"] },
      { ...base, rawSources: ["<b>", "<a>"] },
    );
    expect(r.class).toBe("restyle");
  });
});
