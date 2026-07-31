import { Extension } from "@tiptap/core";
import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core";

/**
 * Lets an EMPTY task item survive a round-trip through disk.
 *
 * `markdown-it-task-lists` decides whether a list item is a task by testing
 * `content.indexOf('[ ] ') === 0` — with a trailing space. markdown-it strips
 * trailing whitespace from inline content, so an item whose entire content is
 * the checkbox (`- [ ]`) can never match, however the file is written. It fell
 * back to a plain bullet holding the literal text `[ ]`, which then serialized
 * *escaped* as `- \[ \]` — so an empty todo did not merely render wrong, it
 * became unrecoverable on the next save.
 *
 * The fix restores the trailing space on exactly those inline tokens, before
 * the task-list rule inspects them. Only `token.content` is touched: the rule
 * reads its checkbox state from there, and its own `slice(3)` then trims the
 * marker off the original text child, leaving it correctly empty.
 */
const EMPTY_TASK = /^\[[ xX]\]$/;

function restoreEmptyTaskMarker(state: StateCore): boolean {
  const { tokens } = state;
  // From index 2: a task item is always inline ← paragraph_open ← list_item_open.
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token.type !== "inline" ||
      tokens[i - 1].type !== "paragraph_open" ||
      tokens[i - 2].type !== "list_item_open" ||
      !EMPTY_TASK.test(token.content)
    ) {
      continue;
    }
    token.content += " ";
  }
  return false;
}

export const EmptyTaskParse = Extension.create({
  name: "emptyTaskParse",

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            // Deliberately `before`, not `after('inline')`: markdown-it throws
            // if the named rule is absent, so if this extension is ever ordered
            // ahead of TaskList the editor fails loudly at construction rather
            // than silently reintroducing the bug.
            markdownit.core.ruler.before(
              "github-task-lists",
              "floatnotes-empty-task",
              restoreEmptyTaskMarker,
            );
          },
        },
      },
    };
  },
});
