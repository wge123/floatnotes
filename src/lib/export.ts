import type { Editor } from "@tiptap/core";

/**
 * Exports (step 09): Copy as Plain Text / Copy as HTML for the ⌘K panel.
 *
 * Both read the LIVE editor document rather than re-parsing the stored
 * markdown — the editor is already the one true parse (same extension list
 * everywhere, see editor-extensions.ts), so there is no second converter to
 * drift.
 */

/** Prose text with blank lines between blocks; markdown markers gone. */
export function toPlainText(editor: Editor): string {
  return editor.getText({ blockSeparator: "\n\n" }).trim();
}

/** Rendered HTML of the document (tags, not markdown). */
export function toHtml(editor: Editor): string {
  return editor.getHTML();
}
