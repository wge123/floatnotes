import { describe, expect, it } from "vitest";

import { splitFrontMatter, withYaml } from "./front-matter";

describe("splitFrontMatter", () => {
  it("splits the leading block and keeps every byte", () => {
    const text = "---\na: 1\nb: [x]\n---\n\n\n# Body\n";
    const { frontMatter, body } = splitFrontMatter(text);
    expect(frontMatter?.yaml).toBe("a: 1\nb: [x]");
    expect(body).toBe("# Body\n");
    expect((frontMatter?.raw ?? "") + body).toBe(text);
  });

  it("accepts an empty block", () => {
    const { frontMatter, body } = splitFrontMatter("---\n---\ntext");
    expect(frontMatter?.yaml).toBe("");
    expect(body).toBe("text");
  });

  it("returns the text untouched when there is no front matter", () => {
    expect(splitFrontMatter("hello")).toEqual({
      frontMatter: null,
      body: "hello",
    });
  });
});

describe("withYaml", () => {
  it("rebuilds the block from exactly the typed YAML", () => {
    const { frontMatter } = splitFrontMatter("---\na: 1\n---\n\nbody");
    const edited = withYaml(frontMatter!, "a: 2\nb: 3");
    expect(edited.raw).toBe("---\na: 2\nb: 3\n---\n\n");
    expect(edited.yaml).toBe("a: 2\nb: 3");
  });

  it("keeps CRLF and an emptied block valid", () => {
    const { frontMatter } = splitFrontMatter("---\r\na: 1\r\n---\r\nbody");
    expect(withYaml(frontMatter!, "a: 2").raw).toBe("---\r\na: 2\r\n---\r\n");
    expect(withYaml(frontMatter!, "").raw).toBe("---\r\n---\r\n");
  });
});
