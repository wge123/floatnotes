import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection, Plugin } from "@tiptap/pm/state";

/**
 * Raw blocks (ADR 0018): content the editor has no node for stays as an atom
 * that carries its source text and writes it back unchanged.
 *
 * - RawBlock: an HTML block, an HTML comment, a footnote definition.
 * - RawInline: an inline HTML tag or comment (`<kbd>`, `</kbd>`, `<!-- -->`)
 *   and a footnote reference (`[^1]`). Text between two tags stays ordinary
 *   editable text; only the tag itself is the atom.
 *
 * HTML detection leans on marked: fenced code, code spans and indented code
 * are consumed by their own tokenizers before any HTML is looked for, so
 * markup inside them never becomes a raw node. Block HTML arrives as marked's
 * own `html` token (CommonMark's seven block kinds); inline HTML and
 * footnotes need tokenizers because @tiptap/markdown routes inline `html`
 * tokens through its own HTML-to-schema parser, which drops unknown tags.
 */

// A tag as marked reads one: quoted attribute values may hold `>`.
const TAG =
  /^<\/?[A-Za-z][\w-]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/;
const COMMENT = /^<!--[\s\S]*?-->/;
const FOOTNOTE_REF = /^\[\^[^\]\s]+\](?!:)/;
const FOOTNOTE_DEF_START = /^ {0,3}\[\^[^\]\s]+\]:/;
// Tags other parts of the editor already own: a break is a hard break (see
// hard-break-markdown) and `<u>` is the underline mark.
const OWNED_TAGS = /^<\/?(?:br|u)\b/i;

/**
 * The first line of a footnote definition plus its continuation: following
 * lines indented by 2+ spaces or a tab, blank lines only when more indented
 * text follows. Returns the consumed source, or null.
 */
export function matchFootnoteDefinition(src: string): string | null {
  if (!FOOTNOTE_DEF_START.test(src)) return null;
  const lines = src.split("\n");
  let end = 1; // exclusive index of the last consumed line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?: {2,}|\t)\S/.test(line)) {
      end = i + 1;
    } else if (line.trim() === "") {
      continue;
    } else {
      break;
    }
  }
  // Keep the newline that ends the last line, as stock block tokens do.
  const consumed = lines.slice(0, end).join("\n");
  return end < lines.length ? `${consumed}\n` : consumed;
}

const COMPONENT_OPEN = /^ {0,3}<([A-Z][A-Za-z0-9]*)(?:\s[^<>]*)?>[ \t]*$/;

/**
 * A component element, as MDX docs pages write them: an opening tag alone on
 * its line, `<Tabs>` or `<Tab title="x">`, with a capital letter (HTML tags are
 * lowercase), through its matching closing tag, blank lines and indented
 * content included. The stock HTML block ends at the first blank line, so the
 * content after it read as indented code (and a fence inside it went wrong on
 * save). Same-name tags nest. Returns the consumed source, or null when the
 * opening tag is self-closed or never closed.
 */
export function matchComponentBlock(src: string): string | null {
  // The lexer offers every block position the whole rest of the note: test the
  // first line before splitting the rest.
  const eol = src.indexOf("\n");
  const open = COMPONENT_OPEN.exec(eol < 0 ? src : src.slice(0, eol));
  if (!open) return null;
  const lines = src.split("\n");
  if (lines[0].trimEnd().endsWith("/>")) return null;
  const name = open[1];
  const opens = new RegExp(`<${name}(?=[\\s>/])[^<>]*?(/?)>`, "g");
  const closes = new RegExp(`</${name}\\s*>`, "g");
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(opens)) if (m[1] !== "/") depth++;
    depth -= [...lines[i].matchAll(closes)].length;
    if (depth <= 0) {
      const consumed = lines.slice(0, i + 1).join("\n");
      return i + 1 < lines.length ? `${consumed}\n` : consumed;
    }
  }
  return null;
}

function rawSource(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(`raw block value must be a string, got ${typeof value}`);
  }
  return value;
}

/** Typing over a selected raw node would replace it; it is read-only. */
function blockTypingOverRaw() {
  return new Plugin({
    props: {
      handleTextInput(view) {
        const sel = view.state.selection;
        return (
          sel instanceof NodeSelection && sel.node.type.name.startsWith("raw")
        );
      },
    },
  });
}

export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  // After paragraph in the schema. The doc's default block (what the trailing
  // node and "create a block here" fall back to) is the first block type that
  // needs no attributes, and `value` has a default, so at the stock priority
  // this node could win and the editor would append raw blocks.
  priority: 50,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { value: { default: "", rendered: false } };
  },

  // Block HTML and the tokenizer below (footnote definitions, component
  // elements) both produce `html` tokens.
  markdownTokenName: "html",

  markdownTokenizer: {
    name: "footnoteOrComponent",
    level: "block",
    start: (src: string) => src.search(/\n {0,3}\[\^[^\]\s]+\]:/),
    tokenize(src) {
      const raw = matchFootnoteDefinition(src) ?? matchComponentBlock(src);
      if (!raw) return undefined;
      return { type: "html", raw, text: raw, block: true };
    },
  },

  parseMarkdown(token, helpers) {
    // Inline `html` tokens never reach here (see the header comment).
    if (!token.block) return [];
    const value = (token.raw ?? token.text ?? "").replace(/\n+$/, "");
    if (!value.trim()) return [];
    return helpers.createNode("rawBlock", { value });
  },

  renderMarkdown: (node) => rawSource(node.attrs?.value),

  renderText: ({ node }) => rawSource(node.attrs.value),

  parseHTML() {
    return [
      {
        tag: "div[data-raw-block]",
        getAttrs: (el) => ({ value: (el as HTMLElement).textContent ?? "" }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-raw-block": "",
        contenteditable: "false",
        class: "raw-block",
      }),
      ["pre", {}, rawSource(node.attrs.value)],
    ];
  },

  addProseMirrorPlugins() {
    return [blockTypingOverRaw()];
  },
});

export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { value: { default: "", rendered: false } };
  },

  markdownTokenName: "rawInline",

  markdownTokenizer: {
    name: "rawInline",
    level: "inline",
    start: (src: string) => src.search(/<|\[\^/),
    tokenize(src) {
      let raw: string | undefined;
      if (src.startsWith("<")) {
        raw = COMMENT.exec(src)?.[0];
        if (!raw && !OWNED_TAGS.test(src)) raw = TAG.exec(src)?.[0];
      } else if (src.startsWith("[^")) {
        raw = FOOTNOTE_REF.exec(src)?.[0];
      }
      if (!raw) return undefined;
      return { type: "rawInline", raw, text: raw };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("rawInline", { value: token.raw ?? "" });
  },

  renderMarkdown: (node) => rawSource(node.attrs?.value),

  renderText: ({ node }) => rawSource(node.attrs.value),

  parseHTML() {
    return [
      {
        tag: "span[data-raw-inline]",
        getAttrs: (el) => ({ value: (el as HTMLElement).textContent ?? "" }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-raw-inline": "",
        contenteditable: "false",
        class: "raw-inline",
      }),
      rawSource(node.attrs.value),
    ];
  },

  addProseMirrorPlugins() {
    return [blockTypingOverRaw()];
  },
});
