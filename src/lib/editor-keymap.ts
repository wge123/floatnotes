import { Extension } from "@tiptap/core";

import { TextSelection } from "@tiptap/pm/state";
import {
  isInTable,
  moveCellForward,
  nextCell,
  selectionCell,
} from "@tiptap/pm/tables";

import { insertTable } from "./format";

/**
 * Editor-scoped Raycast Notes formatting keymap (step 02 contract).
 *
 * Most chords match TipTap defaults; they are declared explicitly so the
 * keymap is authoritative in one file rather than scattered across
 * extension defaults. "Mod" = ⌘ on macOS.
 */
export const EditorKeymap = Extension.create({
  name: "floatnotesKeymap",

  addKeyboardShortcuts() {
    return {
      // Marks
      "Mod-b": () => this.editor.commands.toggleBold(),
      "Mod-i": () => this.editor.commands.toggleItalic(),
      "Mod-u": () => this.editor.commands.toggleUnderline(),
      "Mod-Shift-s": () => this.editor.commands.toggleStrike(),
      "Mod-e": () => this.editor.commands.toggleCode(),

      // Link: toggle off when active, otherwise prompt for a URL
      "Mod-l": () => {
        const { editor } = this;
        if (editor.isActive("link")) {
          return editor.chain().focus().unsetLink().run();
        }
        const url = window.prompt("Link URL");
        if (!url) return true;
        return editor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url })
          .run();
      },

      // Blocks
      "Mod-Alt-1": () => this.editor.commands.toggleHeading({ level: 1 }),
      "Mod-Alt-2": () => this.editor.commands.toggleHeading({ level: 2 }),
      "Mod-Alt-3": () => this.editor.commands.toggleHeading({ level: 3 }),
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),

      // Tables
      "Mod-Alt-t": () => {
        insertTable(this.editor);
        return true;
      },

      // Enter in a cell moves to the same column in the next row, and does
      // nothing in the last row (ADR 0019, superseding ADR 0013's no-op). A
      // cell holding two blocks is not pipe-serializable, so Enter must never
      // split one. Outside a table this returns false and the default Enter
      // handling runs.
      Enter: () => {
        const { state, view } = this.editor;
        if (!isInTable(state)) return false;
        const below = nextCell(selectionCell(state), "vert", 1);
        if (below) {
          view.dispatch(
            state.tr
              .setSelection(
                TextSelection.near(
                  state.doc.resolve(moveCellForward(below).pos - 1),
                  -1,
                ),
              )
              .scrollIntoView(),
          );
        }
        return true;
      },

      // Lists
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),

      // Toggle the checked state of the task item under the caret
      "Mod-Enter": () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === "taskItem") {
            const pos = $from.before(depth);
            return this.editor.commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: !node.attrs.checked,
              });
              return true;
            });
          }
        }
        return false;
      },
    };
  },
});
