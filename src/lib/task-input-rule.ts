import { Extension, InputRule } from "@tiptap/core";

/**
 * Raycast-parity todo typing: `[ ]`, `[]`, or `[x]` + space at the start of a
 * BULLET item converts it to a task item; at the start of an existing task
 * item it sets that item's checked state.
 *
 * TaskItem's own input rule covers plain paragraphs but silently no-ops
 * inside a listItem (wrappingInputRule can't wrap there), so the natural
 * "- [ ] " keystroke sequence left literal bracket text — which then
 * serialized escaped (`- \[ \]`) and could never become a todo again.
 */
export const TaskListInputRule = Extension.create({
  name: "taskListInputRule",

  addInputRules() {
    return [
      new InputRule({
        // Anchored at block start: the brackets must be the whole prefix.
        find: /^\[([ xX])?\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const { $from } = state.selection;
          const checked = match[1]?.toLowerCase() === "x";
          // Already a task item: set its state, never wrap (would nest lists).
          if ($from.node(-1).type.name === "taskItem") {
            chain()
              .deleteRange(range)
              .updateAttributes("taskItem", { checked })
              .run();
            return;
          }
          // Otherwise bullet items only: paragraphs are TaskItem's rule.
          if ($from.node(-1).type.name !== "listItem") return;
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .updateAttributes("taskItem", { checked })
            .run();
        },
      }),
    ];
  },
});
