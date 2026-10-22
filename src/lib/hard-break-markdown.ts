import { HardBreak } from "@tiptap/extension-hard-break";

/**
 * A hard line break is saved as a backslash before the newline, as it always
 * was, not TipTap 3's two trailing spaces. Two spaces cannot express two
 * breaks in a row: the second line is then all whitespace, which markdown
 * reads as a paragraph gap, so a note with `\` on a line of its own (real
 * notes have these) turned its breaks into paragraphs on the next load.
 */
export const NoteHardBreak = HardBreak.extend({
  renderMarkdown: () => "\\\n",
});
