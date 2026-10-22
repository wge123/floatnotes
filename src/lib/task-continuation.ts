import type { MarkdownLexerConfiguration as Lexer } from "@tiptap/core";

/**
 * Wrapped lines of a task item (ADR 0017).
 *
 * TipTap's task-list tokenizer takes the item's first line as its text and
 * treats every deeper-indented line after it as NESTED content, dedented by
 * exactly the item's indent + 2. A line wrapped under the text after `- [ ] `
 * (6 columns in) kept 4 spaces and read as an indented code block; one at 2
 * columns read as a separate paragraph, so a bold or code span that runs across
 * the break broke, and the note lost its markup or its line break.
 *
 * Two steps, around the stock tokenizer:
 *
 * 1. `alignContinuations` rewrites the indent of each wrapped line (a
 *    non-blank, deeper line directly after the item line, that does not start a
 *    block of its own) to indent + 2, which the stock dedent turns into column 0.
 * 2. `foldContinuations` takes the paragraph that results, which has no blank
 *    line before it, back into the item's own text and lexes the whole as one
 *    inline run, so it keeps its soft breaks and spanning marks.
 */
const TASK_ITEM = /^(\s*)[-+*]\s+\[[ xX]\]\s+(.*)$/;
// A line that starts a block of its own, so it is not a wrapped line: another
// list item, a fence, a quote, a heading, a table row, a thematic break, HTML.
const BLOCK_START = /^\s*(?:[-+*]\s|\d{1,9}[.)]\s|```|~~~|>|#{1,6}\s|\||<|(?:[-*_]\s*){3,}$)/;

export function alignContinuations(lines: string[]): string[] {
  const out = [...lines];
  for (let i = 0; i < out.length; i++) {
    const item = TASK_ITEM.exec(out[i]);
    if (!item) continue;
    const indent = item[1].length;
    for (let j = i + 1; j < out.length; j++) {
      const line = out[j];
      const lead = /^\s*/.exec(line)![0].length;
      if (line.trim() === "" || lead <= indent || BLOCK_START.test(line)) break;
      out[j] = " ".repeat(indent + 2) + line.trim();
    }
  }
  return out;
}

interface ItemToken {
  type: string;
  mainContent?: string;
  text?: string;
  tokens?: unknown[];
  nestedTokens?: ItemToken[];
  items?: ItemToken[];
}

/** Fold a no-blank-line paragraph that opens an item's nested tokens into the item's text. */
export function foldContinuations(list: ItemToken, lexer: Lexer): void {
  for (const item of list.items ?? []) {
    const nested = item.nestedTokens;
    const first = nested?.[0] as (ItemToken & { text?: string }) | undefined;
    if (nested && first?.type === "paragraph" && typeof first.text === "string") {
      const joined = `${item.mainContent ?? item.text ?? ""}\n${first.text}`;
      item.mainContent = joined;
      item.text = joined;
      item.tokens = lexer.inlineTokens(joined);
      nested.shift();
    }
    for (const t of item.nestedTokens ?? []) if (t.type === "taskList") foldContinuations(t, lexer);
  }
}
