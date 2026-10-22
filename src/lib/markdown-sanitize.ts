import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

/**
 * @tiptap/markdown builds document JSON without checking it against the
 * schema, so some markdown comes out as a document ProseMirror rejects (found
 * by the corpus check, which validates every note it loads). An invalid
 * document does not fail at load: it throws later, in the first transaction
 * that touches the bad spot, and TipTap's trailing-node step throws on every
 * transaction after it. These repairs make the output valid by construction:
 *
 * - the same mark twice on one text (`**a **b** c**`, nested `~~`)
 * - a list or task item with no content, or one that starts with a nested list
 *   (an item's first child must be a paragraph)
 * - inline nodes sitting directly in a block container (a table cell, quote,
 *   item or the document itself) instead of inside a paragraph
 */
const INLINE = new Set(["text", "image", "hardBreak"]);
const CONTAINERS = new Set([
  "doc",
  "blockquote",
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
]);
const ITEMS = new Set(["listItem", "taskItem"]);

export function sanitizeDoc(node: JSONContent): JSONContent {
  const next: JSONContent = { ...node };

  if (node.marks && node.marks.length > 1) {
    const seen = new Set<string>();
    next.marks = node.marks.filter((m) => {
      if (seen.has(m.type)) return false;
      seen.add(m.type);
      return true;
    });
  }

  if (!node.content) {
    if (ITEMS.has(node.type ?? "")) next.content = [{ type: "paragraph" }];
    return next;
  }

  let content = node.content.map(sanitizeDoc);

  if (CONTAINERS.has(node.type ?? "")) {
    const wrapped: JSONContent[] = [];
    let run: JSONContent[] = [];
    const flush = () => {
      if (run.length > 0) wrapped.push({ type: "paragraph", content: run });
      run = [];
    };
    for (const child of content) {
      if (INLINE.has(child.type ?? "")) run.push(child);
      else {
        flush();
        wrapped.push(child);
      }
    }
    flush();
    content = wrapped;
    if (ITEMS.has(node.type ?? "") && content[0]?.type !== "paragraph") {
      content = [{ type: "paragraph" }, ...content];
    }
  }

  next.content = content;
  return next;
}

let installed = false;

/**
 * Run every markdown parse through `sanitizeDoc`. The parse method is on the
 * manager class and the extension builds its manager internally, so there is
 * no instance to wrap; the prototype is patched once.
 */
export function installParseSanitizer(): void {
  if (installed) return;
  installed = true;
  const parse = MarkdownManager.prototype.parse;
  MarkdownManager.prototype.parse = function (markdown: string) {
    return sanitizeDoc(parse.call(this, markdown));
  };
}
