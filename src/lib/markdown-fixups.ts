import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { ListItem } from "@tiptap/extension-list";
import type { JSONContent } from "@tiptap/core";

/**
 * Four places where @tiptap/markdown 3.31.4 loses or corrupts a note that the
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
});

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
    while (content.length > 0 && content[content.length - 1].type === "hardBreak") {
      content = content.slice(0, -1);
    }
    next.content = content;
  }
  return next;
}
