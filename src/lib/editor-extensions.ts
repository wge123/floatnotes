import { Search } from "./search-extension";
import type { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Marked, type marked } from "marked";
import StarterKit from "@tiptap/starter-kit";

import { type FrontMatter, splitFrontMatter } from "./front-matter";
import { EditorKeymap } from "./editor-keymap";
import { EmptyTaskList } from "./empty-task-list";
import { LinkClick } from "./link-click";
import { MarkdownPaste } from "./markdown-paste";
import { RevealMarkers } from "./reveal-markers";
import { NoteHardBreak } from "./hard-break-markdown";
import {
  NoteCode,
  NoteCodeBlock,
  NoteImage,
  NoteListItem,
  NoteOrderedList,
  NoteParagraph,
  NoteTaskItem,
  prepareForSave,
} from "./markdown-fixups";
import { NoteTable } from "./table-markdown";
import { installParseSanitizer } from "./markdown-sanitize";
import { RawBlock, RawInline } from "./raw-blocks";
import { NoteUnderline, SpelledLink, WikiLinkText, spellMarks, cleanEscapes } from "./saved-spelling";
import { TaskListInputRule } from "./task-input-rule";
import { TrailingParagraph, getSerializationDocument } from "./trailing-paragraph";

/**
 * The one extension list every FloatNotes editor instance uses — the React
 * component and the headless test editors must stay identical, so both build
 * from here.
 *
 * Content must be loaded with `contentType: "markdown"` (the editor option, and
 * `setContent`'s option): a bare string is parsed as HTML in TipTap 3.
 */
export function buildEditorExtensions(placeholder = "Start writing…") {
  installParseSanitizer();
  return [
    // All six levels parse, so a note's #### survives a save; the toolbar
    // still offers only H1-H3 (FormatBar's HEADING_LEVELS).
    // StarterKit v3 bundles Link and Underline, so they are configured here.
    // openOnClick stays false because the caret has to win a plain click inside
    // a contenteditable; LinkClick (below) puts opening behind Cmd-click.
    // The trailing node is swapped for TrailingParagraph, which StarterKit
    // would otherwise add unwrapped.
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: false,
      code: false,
      codeBlock: false,
      paragraph: false,
      orderedList: false,
      trailingNode: false,
      hardBreak: false,
      listItem: false,
      underline: false,
    }),
    TrailingParagraph,
    NoteHardBreak,
    NoteListItem,
    NoteCode,
    NoteCodeBlock,
    NoteParagraph,
    NoteOrderedList,
    NoteUnderline,
    SpelledLink.configure({ openOnClick: false, autolink: true }),
    // Inline so an image stays inside its sentence instead of splitting the
    // paragraph around it. The src is kept as written; a relative path does
    // not resolve in the webview yet, so the image shows as broken but its
    // markdown survives.
    NoteImage.configure({ inline: true }),
    LinkClick,
    EmptyTaskList,
    NoteTaskItem.configure({ nested: true }),
    TaskListInputRule,
    // resizable stays off: the column-resize plugin listens on the same
    // pointer stream lib/drag.ts uses to move the NSPanel, so a drag near a
    // column edge would be ambiguous. Column widths have no markdown
    // representation anyway.
    TableKit.configure({ table: false }),
    NoteTable.configure({ resizable: false }),
    RawBlock,
    RawInline,
    WikiLinkText,
    Placeholder.configure({ placeholder }),
    // A private marked instance per editor. The default is one shared global
    // that every editor registers its tokenizers into, so each editor built in
    // a process made the next one slower (60 editors: 80ms to 500ms for a 90KB
    // note) and kept every earlier editor's tokenizers alive.
    Markdown.configure({ marked: new Marked() as unknown as typeof marked }),
    Search, // literal-text find; classes styled in App.css
    // Decoration-only, so position in this list is free: it reads the selection
    // and draws widgets, and hooks no other extension's rules. ADR 0005's
    // post-v1 reveal-on-caret.
    RevealMarkers,
    MarkdownPaste,
    EditorKeymap,
  ];
}

/**
 * The note-level pair every caller uses (editor, headless tests, corpus
 * check). `loadNote` splits leading front matter off before the editor sees
 * the text; `saveNote` prepends it unchanged (ADR 0018). Persisted content is
 * ALWAYS markdown (never getHTML()), and an untouched trailing paragraph the
 * trailing node added is left out.
 */
export function loadNote(text: string): {
  frontMatter: FrontMatter | null;
  content: string;
} {
  const { frontMatter, body } = splitFrontMatter(text);
  return { frontMatter, content: body };
}

export function saveNote(
  editor: Editor,
  frontMatter: FrontMatter | null = null,
): string {
  const body = cleanEscapes(
    editor,
    editor.markdown!.serialize(
      prepareForSave(spellMarks(getSerializationDocument(editor).toJSON())),
    ),
  );
  return (frontMatter?.raw ?? "") + body;
}
