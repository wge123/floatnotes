import { Code } from "@tiptap/extension-code";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Paragraph } from "@tiptap/extension-paragraph";
import { ListItem, OrderedList, TaskItem } from "@tiptap/extension-list";
import type { JSONContent } from "@tiptap/core";

/**
 * Eight places where @tiptap/markdown 3.31.4 loses or corrupts a note that the
 * editor on TipTap 2 kept. Each one was found by the corpus check
 * (scripts/corpus-check) against real notes.
 */

/**
 * A badge, `[![alt](img)](https://target)`, parses to an image node carrying a
 * link mark. The serializer closes every mark before a non-text node and
 * reopens it after, so the link wrapped nothing and the target was lost:
 * `![alt](img)[`. `prepareForSave` moves the link onto the image as
 * attributes, and this renders it back around the image.
 */
export const NoteImage = Image.extend({
  renderMarkdown(node, helpers, context) {
    const image = this.parent?.(node, helpers, context) ?? "";
    const href = node.attrs?.linkHref as string | undefined;
    if (!href) return image;
    const title = node.attrs?.linkTitle as string | undefined;
    const dest = /[\s()]/.test(href) ? `<${href}>` : href;
    return `[${image}](${dest}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
  },
});

/**
 * The stock paragraph handler unwraps a paragraph that holds only an image
 * (`![alt](src)` on its own line), on the assumption that images are blocks.
 * Here the image is inline, so that left an image directly under the document,
 * which the schema rejects. Keep it in its paragraph.
 */
export const NoteParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0].type === "image") {
      return { type: "paragraph", content: helpers.parseInline(tokens) };
    }
    return this.parent?.(token, helpers) ?? [];
  },
});

/**
 * Inline code excludes every other mark by default, but the markdown parser
 * builds marks without checking, so `[`npm`](https://x)` or **`bold code`**
 * became a text node holding link+code, which the schema rejects. The document
 * was invalid, and TipTap's trailing-node step threw on it at every
 * transaction. Code coexists with other marks instead, which markdown writes
 * back as it read it.
 */
export const NoteCode = Code.extend({ excludes: "" });

/**
 * `[![alt](img)](https://example.com)` loses its link on load: the markdown
 * parser puts a mark only on text nodes, and the image between the brackets is
 * not one. The link is applied to inline images here as well.
 */
export const NoteLink = Link.extend({
  parseMarkdown(token, helpers) {
    const mark = {
      type: "link",
      attrs: { href: token.href, title: token.title || null },
    };
    const wrap = (nodes: JSONContent[]): JSONContent[] =>
      nodes.map((n) => {
        if (n.type === "text" || n.type === "image") {
          return { ...n, marks: [...(n.marks ?? []), mark] };
        }
        return n.content ? { ...n, content: wrap(n.content) } : n;
      });
    return wrap(helpers.parseInline(token.tokens || []));
  },
});

/**
 * Markdown's list item handler treats only the FIRST text token of an item as
 * inline-parsed. A paragraph that follows a nested block in the same tight
 * item (`- item`, an indented code fence, then more text) arrives as a bare
 * `text` token and became a raw text node directly inside the list item, with
 * its backticks and brackets unparsed and escaped on save. Turn such tokens
 * into paragraphs before the stock handler sees them.
 */
export const NoteListItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    if (
      token.type === "list_item" &&
      token.tokens &&
      token.tokens.some((t, i) => i > 0 && t.type === "text" && t.tokens)
    ) {
      return this.parent?.(
        {
          ...token,
          tokens: token.tokens.map((t) =>
            t.type === "text" && t.tokens ? { ...t, type: "paragraph" } : t,
          ),
        },
        helpers,
      ) ?? [];
    }
    return this.parent?.(token, helpers) ?? [];
  },

  renderMarkdown(node, helpers, context) {
    return indentContinuation(this.parent?.(node, helpers, context) ?? "", node, helpers);
  },
});

const orderedBase = OrderedList.config.markdownTokenizer!;
// Cheap test of the first line, so a long note is not re-split at every block.
const ORDERED_FIRST_LINE = /^[ \t]*[0-9a-zA-Z]{1,6}[.)][ \t]+/;

/**
 * TipTap 3's numbered-list tokenizer takes an item's text to start
 * `marker.length + 1` columns in, which forgets the `.` of `1.`: one column
 * short, so every nested block under a numbered item kept a stray leading
 * space. A fenced code block gained a space on each line per load, and a
 * fence right after a heading inside an item vanished. Shifting the nested
 * lines left by one first makes its own arithmetic come out right.
 */
export const NoteOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...orderedBase,
    tokenize(src, tokens, lexer) {
      if (!ORDERED_FIRST_LINE.test(src)) return undefined;
      const base = /^[ \t]*/.exec(src)![0].length;
      const lines = src.split("\n");
      const shifted = lines.map((line) => {
        const lead = /^ */.exec(line)![0].length;
        return lead >= base + 2 && line.trim() !== "" ? line.slice(1) : line;
      });
      const token = orderedBase.tokenize(shifted.join("\n"), tokens, lexer);
      if (!token) return token;
      // raw is the consumed lines; take them from the unshifted source.
      const consumed = (token.raw ?? "").split("\n").length;
      token.raw = lines.slice(0, consumed).join("\n");
      return token;
    },
  },
});

/** A task item has the same continuation-line problem as a bullet. */
export const NoteTaskItem = TaskItem.extend({
  renderMarkdown(node, helpers, context) {
    return indentContinuation(this.parent?.(node, helpers, context) ?? "", node, helpers);
  },
});

/**
 * A paragraph inside a list item can hold soft line breaks, and the stock
 * serializer leaves their continuation lines flush left. Markdown accepts
 * that (a "lazy continuation"), but marked 17 ends the item early on some of
 * them, e.g. a line that starts with `(` and a code span beginning with `#`,
 * which split one paragraph in two on the next load. Indent the continuation
 * lines to the item's text, the form the notes were written in.
 */
function indentContinuation(
  out: string,
  node: JSONContent,
  helpers: { renderChild?: (child: JSONContent, index: number) => string },
): string {
  const first = node.content?.[0];
  if (first?.type !== "paragraph") return out;
  const paragraph = helpers.renderChild?.(first, 0);
  if (!paragraph) return out;
  if (!paragraph.includes("\n")) return out;
  const at = out.indexOf(paragraph);
  if (at < 0) return out;
  const pad = " ".repeat(at);
  const indented = paragraph
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : pad + line))
    .join("\n");
  return out.slice(0, at) + indented + out.slice(at + paragraph.length);
}

/**
 * Shape the document the way the serializer can write it back losslessly.
 *
 * - An image with a link mark carries the link as attributes instead (see
 *   NoteImage).
 * - A hard break at the end of a block says nothing in markdown, and written
 *   as `\` + newline it became a literal backslash on the next load, so it is
 *   dropped.
 * - A heading cannot span lines. A setext heading over several lines parses to
 *   one with newlines in it, which an ATX `#` heading would break on save, so
 *   its newlines and breaks become spaces.
 */
export function prepareForSave(node: JSONContent): JSONContent {
  const next: JSONContent = { ...node };
  if (node.type === "image" && node.marks?.some((m) => m.type === "link")) {
    const link = node.marks.find((m) => m.type === "link");
    next.attrs = {
      ...node.attrs,
      linkHref: link?.attrs?.href,
      linkTitle: link?.attrs?.title,
    };
    const rest = node.marks.filter((m) => m.type !== "link");
    if (rest.length > 0) next.marks = rest;
    else delete next.marks;
  }
  if (node.content) {
    let content = node.content.map(prepareForSave);
    if (node.type === "heading") {
      content = content.map((c) =>
        c.type === "hardBreak"
          ? { type: "text", text: " " }
          : c.type === "text" && c.text
            ? { ...c, text: c.text.replace(/\s*\n\s*/g, " ") }
            : c,
      );
    }
    // `<br/>` at the end of a source line leaves that line's newline as the
    // start of the next text. Written after a break it would be a blank line
    // and split the paragraph, so the break alone stands for it.
    content = content.map((c, i) =>
      i > 0 &&
      content[i - 1].type === "hardBreak" &&
      c.type === "text" &&
      c.text
        ? { ...c, text: c.text.replace(/^[ \t]*\n/, "") }
        : c,
    );
    while (content.length > 0 && content[content.length - 1].type === "hardBreak") {
      content = content.slice(0, -1);
    }
    next.content = content;
  }
  return next;
}
