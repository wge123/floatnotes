import { TaskList } from "@tiptap/extension-list";

import { alignContinuations, foldContinuations } from "./task-continuation";
import { originalRaw } from "./tokenizer-raw";

/**
 * Lets an EMPTY task item survive a round-trip through disk.
 *
 * TipTap's task-list tokenizer only treats a line as a task when the checkbox
 * is followed by whitespace (`- [ ] `). An item that is just the checkbox
 * (`- [ ]`, trailing space stripped by an editor or a sync tool) matches no
 * item, so the list ended there and the neighbouring tasks lost their
 * checkboxes. This wrapper pads such a line with the missing space before the
 * stock tokenizer sees it, then trims `raw` back to the source it really
 * consumed so the lexer's position stays right.
 */
const base = TaskList.config.markdownTokenizer!;

const BARE_TASK_LINE = /^(\s*[-+*]\s+\[[ xX]\])$/;
const TASK_START = /^\s*[-+*]\s+\[[ xX]\](?:\s|$)/;

export const EmptyTaskList = TaskList.extend({
  markdownTokenizer: {
    ...base,
    start(src: string) {
      return TASK_START.test(src) ? 0 : -1;
    },
    tokenize(src, tokens, lexer) {
      // The lexer offers every block position the whole remaining source, and
      // the stock tokenizer splits all of it into lines before it can say no.
      // Over a long note that is quadratic, so refuse early unless this
      // position really starts a task item.
      if (!TASK_START.test(src)) return undefined;
      const lines = src.split("\n");
      const prepared = alignContinuations(lines).map((line) =>
        BARE_TASK_LINE.test(line) ? `${line} ` : line,
      );
      const token = base.tokenize(prepared.join("\n"), tokens, lexer);
      if (!token) return token;
      // The lexer advances by `raw`'s length, so it must be the source text
      // actually consumed, not the padded or re-indented copy.
      token.raw = originalRaw(lines, token.raw ?? "");
      foldContinuations(token as never, lexer);
      return token;
    },
  },
});
