import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions, loadNote, saveNote } from "./editor-extensions";

/**
 * Notes the TipTap 3 markdown extension corrupts out of the box, each found by
 * the corpus check against real notes (todo 041962f5). The TipTap 2 editor
 * kept all of them.
 */
let editor: Editor;

function roundTrip(note: string): string {
  const { frontMatter, content } = loadNote(note);
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  return saveNote(editor, frontMatter);
}

afterEach(() => editor?.destroy());

// Found by the editor-blind corpus check (review of todo f9134a04): the stock
// code block drops a fenced block whose fence is indented, which marked hands
// over when a fence sits inside a list item.
describe("a fenced code block indented inside a list item", () => {
  it("keeps the code under a bullet written with four spaces", () => {
    expect(roundTrip("- Download\n    ```\n    code1\n    ```\n- Last")).toBe(
      "- Download\n  ```\n  code1\n  ```\n- Last",
    );
  });

  it("keeps the language and the code", () => {
    expect(roundTrip("- a\n    ```py\n    x = 1\n    ```")).toBe("- a\n  ```py\n  x = 1\n  ```");
  });

  it("still drops nothing when the fence is flush with the item text", () => {
    const note = "- Download\n  ```\n  code1\n  ```\n- Last";
    expect(roundTrip(note)).toBe(note);
  });
});

describe("a linked image (README badge)", () => {
  const badge = "[![PyPI](https://img.example/p.svg)](https://pypi.example/p/)";

  it("keeps the link around the image", () => {
    expect(roundTrip(badge)).toBe(badge);
  });

  it("keeps a row of badges, and converges", () => {
    const row = `${badge}\n[![Py](https://img.example/q.svg)](https://pypi.example/q/)`;
    const once = roundTrip(row);
    expect(once).toBe(row);
    expect(roundTrip(once)).toBe(once);
  });

  // Raw blocks (ADR 0018, todo 2d04819c): HTML is kept as written rather than
  // converted to markdown, so the link and every attribute survive.
  it("keeps the link when the badge is written as HTML", () => {
    const html =
      '<a href="https://pypi.example/p/"><img src="https://img.example/p.svg" alt="PyPI"></a>';
    expect(roundTrip(html)).toBe(html);
  });
});

describe("a hard break", () => {
  it("is not turned into a stray backslash when it ends a paragraph", () => {
    const once = roundTrip("one<br/>\n\ntwo");
    expect(once).toBe("one\n\ntwo");
    expect(roundTrip(once)).toBe(once);
  });

  it("is kept as a backslash break, so two in a row survive", () => {
    const note = "first\\\n\\\nsecond";
    expect(roundTrip(note)).toBe(note);
  });
});

describe("a multi-line setext heading", () => {
  it("stays one heading line instead of spilling into the next paragraph", () => {
    const once = roundTrip("title line\nsecond line\n--\n\nbody");
    expect(once).toBe("## title line second line\n\nbody");
    expect(roundTrip(once)).toBe(once);
  });
});

describe("text after a code fence inside a list item", () => {
  it("is parsed as inline markdown, not kept as raw text", () => {
    const out = roundTrip("- item\n  ```sh\n  ls\n  ```\n  then run `ls -h` [here].\n- next");
    expect(out).toContain("then run `ls -h`");
    expect(out).not.toContain("\\`");
    expect(roundTrip(out)).toBe(out);
  });

  it("builds a schema-valid document", () => {
    roundTrip("- item\n  ```sh\n  ls\n  ```\n  then run `ls`\n- next");
    expect(() => editor.state.doc.check()).not.toThrow();
  });
});

describe("documents the schema accepts", () => {
  const valid = (note: string) => {
    roundTrip(note);
    expect(() => editor.state.doc.check()).not.toThrow();
  };

  it("keeps a lone image inside its paragraph", () => {
    valid("para\n\n![alt](pic.png)\n\nmore");
    expect(roundTrip("![alt](pic.png)")).toBe("![alt](pic.png)");
    valid('<img src="pic.png" alt="alt" width="400" />');
  });

  it("lets inline code carry a link or bold, and writes them back", () => {
    const note = "see [`npm`](https://example.com) and **`bold code`**";
    valid(note);
    expect(roundTrip(note)).toBe(note);
  });
});

describe("a break written as <br/> at the end of a source line", () => {
  it("does not split the paragraph on save", () => {
    const once = roundTrip("- one<br/>\ntwo<br/>\nthree\n");
    expect(once).toBe("- one\\\n  two\\\n  three");
    expect(roundTrip(once)).toBe(once);
  });
});

describe("a wrapped paragraph inside a list item", () => {
  // marked 17 ends the item at the line after one that starts with `(` and
  // holds a code span beginning with `#`, unless the lines are indented.
  const note =
    "- shebang fixed in `x`\n  (`#!/usr/bin/env bun`, commit 6ef in the dir\n  repo, no remote, landed by ff)";

  it("keeps its continuation lines indented, and stays one paragraph", () => {
    const once = roundTrip(note);
    expect(once).toBe(note);
    expect(roundTrip(once)).toBe(once);
  });
});

describe("blocks nested under a numbered list item", () => {
  it("keeps a code fence's text exact instead of gaining a space per load", () => {
    const note = "1. step\n   ```bash\n   pip install x\n   ```\n2. two";
    const once = roundTrip(note);
    expect(once).toBe(note);
    expect(roundTrip(once)).toBe(note);
    expect(editor.getText()).toContain("pip install x");
    expect(editor.getText()).not.toContain(" pip install");
  });

  it("keeps a fence that follows a heading inside the item", () => {
    const note = "2. item\n   #### Windows\n   ```\n   *Pre: ok.*\n   ```\n3. next";
    expect(roundTrip(note)).toBe(note);
  });

  it("handles a two-digit marker", () => {
    const note = "10. step\n    ```\n    cmd\n    ```\n11. two";
    const once = roundTrip(note);
    expect(roundTrip(once)).toBe(once);
    expect(editor.getText()).not.toContain(" cmd");
  });

  it("still nests a numbered list under a numbered item", () => {
    const note = "1. one\n   1. inner a\n   2. inner b\n2. two";
    const once = roundTrip(note);
    expect(once).toBe(note);
  });
});

describe("one markdown parser per editor", () => {
  const registered = () => {
    const e = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: "x",
      contentType: "markdown",
    });
    const ext = e.markdown!.instance.defaults.extensions as { block?: unknown[] } | null;
    const count = ext?.block?.length ?? 0;
    e.destroy();
    return count;
  };

  // TipTap registers its tokenizers into one shared parser by default, so each
  // editor built made the next slower for the life of the process.
  it("does not pile one editor's tokenizers onto the next", () => {
    const first = registered();
    expect(first).toBeGreaterThan(0);
    expect(registered()).toBe(first);
  });
});

// Found by the editor-blind corpus check: TipTap 3's numbered-list tokenizer
// also accepts letters and roman numerals as markers, so a sentence that
// starts with a short word and a full stop became a list item and the word
// turned into "1.". Markdown only has digits.
describe("a line that starts with a word and a full stop", () => {
  it.each([
    "No. One Pro license works on all platforms.",
    "No. Hooks hand events off and return immediately.",
    "Mr. Smith came.",
    "I. Introduction",
    "a. first\nb. second",
    "iv) fourth",
  ])("stays a paragraph: %j", (note) => {
    expect(roundTrip(note)).toBe(note);
  });

  it("keeps a real numbered list, with a paragraph after a heading", () => {
    const note = "### Q\n\n1. one\n2. two\n\nNo. Not a list.";
    expect(roundTrip(note)).toBe(note);
  });
});
