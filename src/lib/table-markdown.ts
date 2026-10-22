import { Table } from "@tiptap/extension-table";

import { callParent } from "./parent-renderer";

/**
 * TipTap 3's table serializer wraps its output in a leading and a trailing
 * newline, and the block joiner then adds its own blank line, so a table gets
 * two blank lines above it, a note that starts with one gets a blank first
 * line, and a final table gains a newline the note never had. Every other
 * block serializes bare, so trim the table to match.
 */
export const NoteTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    const out = callParent("Table", this.parent, node, helpers, context);
    // Inside a list item the leading newline is what separates the table from
    // the item's text (a table cannot follow a paragraph line directly), so
    // only the top level loses it.
    const trimmed = out.replace(/\n+$/, "");
    return context?.parentType === "doc" ? trimmed.replace(/^\n+/, "") : trimmed;
  },
});
