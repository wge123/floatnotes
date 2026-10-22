import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

/**
 * @tiptap/markdown writes every text node HTML-encoded (`->` as `-&gt;`, `&` as
 * `&amp;`), so other tools show the entities. Plain text is written as typed
 * instead (ADR 0017: a save may restyle, and this is a restyle other tools
 * read better). Only a character that would be read as markup is escaped, with
 * a backslash:
 *
 * - `&` that starts something entity-shaped (`&amp;`, `&#38;`): typed text
 *   `&amp;` must reload as `&amp;`, not as `&`.
 * - `<` before a letter, `/`, `!` or `?`: a tag, a comment or an autolink,
 *   which reload as a raw inline node. `<15` and `a < b` stay as typed.
 * - `>` at the start of a line: a block quote.
 *
 * These are candidates only. `cleanEscapes` (saved-spelling.ts) drops each one
 * that a re-parse proves unnecessary, e.g. a `>` that is not at a line start
 * once the text is joined to what came before it.
 */
const ENTITY_START = /&(?=#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9]*;)/gi;
const TAG_START = /<(?=[A-Za-z/!?])/g;
const QUOTE_START = /^([ \t]*)>/gm;

export function encodePlainText(text: string): string {
  return text
    .replace(ENTITY_START, "\\&")
    .replace(TAG_START, "\\<")
    .replace(QUOTE_START, "$1\\>");
}

interface TextEncoder {
  codeTypes: Set<string>;
  escapeMarkdownSyntax(text: string): string;
  encodeTextForMarkdown(text: string, node: JSONContent, parentNode?: JSONContent): string;
}

let installed = false;

/**
 * The manager builds its text encoder as a method and the extension creates
 * the manager internally, so there is no instance to wrap; the prototype is
 * patched once (like `installParseSanitizer`). Text in a code mark or a code
 * block is still written verbatim, as the stock method does.
 */
export function installPlainTextEncoder(): void {
  if (installed) return;
  installed = true;
  const proto = MarkdownManager.prototype as unknown as TextEncoder;
  if (typeof proto.encodeTextForMarkdown !== "function" || !(proto.escapeMarkdownSyntax instanceof Function)) {
    throw new Error("installPlainTextEncoder: @tiptap/markdown no longer has the text encoder this patch replaces");
  }
  proto.encodeTextForMarkdown = function (text, node, parentNode) {
    const inCode =
      (parentNode?.type != null && this.codeTypes.has(parentNode.type)) ||
      (node.marks ?? []).some((m) => this.codeTypes.has(typeof m === "string" ? m : m.type));
    if (inCode) return text;
    // Backslashes first: the escapes added below must not be escaped again.
    return encodePlainText(this.escapeMarkdownSyntax(text));
  };
}
