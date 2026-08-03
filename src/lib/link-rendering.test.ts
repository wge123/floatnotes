import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEditorExtensions, serializeMarkdown } from "./editor-extensions";
import { shouldOpen } from "./link-click";

function createEditor(content = ""): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
  });
}

function render(markdown: string): string {
  const editor = createEditor(markdown);
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

function roundTrip(markdown: string): string {
  const editor = createEditor(markdown);
  const out = serializeMarkdown(editor);
  editor.destroy();
  return out;
}

describe("link rendering", () => {
  it.each([
    ["[link](https://example.com)", "https://example.com"],
    ["<https://example.com>", "https://example.com"],
    // The bug: these three carried no <a> at all before linkify was enabled.
    ["https://example.com", "https://example.com"],
    ["www.example.com", "http://www.example.com"],
    ["mail me at a@b.com", "mailto:a@b.com"],
  ])("renders %j as an anchor", (source, href) => {
    expect(render(source)).toContain(`href="${href}"`);
  });

  it("linkifies a bare URL sitting mid-sentence", () => {
    const html = render("see https://example.com for more");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("see ");
    expect(html).toContain(" for more");
  });

  it("keeps a link title through a round-trip", () => {
    const source = '[title](https://example.com "Tip")';
    expect(render(source)).toContain('title="Tip"');
    expect(roundTrip(source)).toBe(source);
  });
});

describe("linkify rewrites converge after one save", () => {
  // linkify is the single place FloatNotes rewrites a note's markdown instead of
  // preserving it, so the rewrite has to be idempotent: a note may change shape
  // once, never drift on every subsequent save.
  it.each([
    ["https://example.com", "<https://example.com>"],
    ["see https://example.com here", "see <https://example.com> here"],
    ["www.example.com", "[www.example.com](http://www.example.com)"],
    ["a@b.com", "[a@b.com](mailto:a@b.com)"],
  ])("%j canonicalises once to %j", (source, canonical) => {
    expect(roundTrip(source)).toBe(canonical);
    expect(roundTrip(canonical)).toBe(canonical);
  });

  it("leaves an already-explicit link untouched", () => {
    const source = "[link](https://example.com)";
    expect(roundTrip(source)).toBe(source);
  });
});

describe("Cmd-click opens a link", () => {
  // Under jsdom there is no __TAURI_INTERNALS__, so openExternal takes the
  // plain-browser branch and window.open is the observable effect.
  afterEach(() => vi.restoreAllMocks());

  /** Click the first anchor the editor rendered, returning the window.open spy. */
  function clickLink(markdown: string, init: MouseEventInit) {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: buildEditorExtensions(),
      content: markdown,
    });
    const anchor = element.querySelector("a");
    expect(anchor).not.toBeNull();
    anchor!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
    );
    editor.destroy();
    element.remove();
    return open;
  }

  it("opens on metaKey click", () => {
    const open = clickLink("[link](https://example.com)", { metaKey: true });
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens on ctrlKey click", () => {
    const open = clickLink("[link](https://example.com)", { ctrlKey: true });
    expect(open).toHaveBeenCalledOnce();
  });

  it("leaves a plain click to the caret", () => {
    expect(clickLink("[link](https://example.com)", {})).not.toHaveBeenCalled();
  });

  // A relative link is the case that reaches the handler and must be refused:
  // markdown-it already declines to build an anchor for a dangerous scheme (see
  // the rendering test below), but `./other.md` is a perfectly ordinary anchor
  // that means nothing to the OS opener.
  it("refuses a relative href even with the modifier held", () => {
    expect(clickLink("[x](./other.md)", { metaKey: true })).not.toHaveBeenCalled();
  });
});

describe("dangerous schemes never become links", () => {
  // markdown-it validates a link target and leaves the source as literal text
  // when it fails, so these never reach the DOM at all. shouldOpen is the second
  // layer, for hrefs written straight into the document by other routes.
  it.each([
    "[x](javascript:alert(1))",
    "[x](vbscript:msgbox)",
    "[x](data:text/html,<b>h</b>)",
    "[x](file:///etc/passwd)",
  ])("renders %j without an anchor", (source) => {
    expect(render(source)).not.toContain("<a ");
  });
});

describe("shouldOpen", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@b.com",
    "tel:+15551234567",
  ])("opens %j", (href) => {
    expect(shouldOpen(href)).toBe(true);
  });

  it.each([
    // A note is a file anyone can write, so a hostile href must not reach the
    // WebView or the OS opener.
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    // Relative note-to-note links mean nothing to the OS opener (yet).
    "./other.md",
    "#heading",
    "",
    null,
    undefined,
  ])("refuses %j", (href) => {
    expect(shouldOpen(href)).toBe(false);
  });
});
