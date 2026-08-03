import SearchAndReplace from "@sereneinserenade/tiptap-search-and-replace";
import type { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { EditorKeymap } from "./editor-keymap";
import { EmptyTaskParse } from "./empty-task-parse";
import { TaskListInputRule } from "./task-input-rule";

/**
 * The one extension list every FloatNotes editor instance uses — the React
 * component and the headless test editors must stay identical, so both build
 * from here.
 */
export function buildEditorExtensions(placeholder = "Start writing…") {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Underline,
    Link.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Must follow TaskList: it hooks the markdown-it rule TaskList installs.
    EmptyTaskParse,
    TaskListInputRule,
    // Tables are schema-only: markdown-it already parses pipe syntax under the
    // default preset, and tiptap-markdown ships a serializer it matches to
    // whichever extension registers a node literally named "table". Order is
    // free here. Unlike EmptyTaskParse, none of these hook another extension's
    // markdown-it rule.
    //
    // resizable stays off (its default, restated because the reason is not
    // obvious): the column-resize plugin listens on the same pointer stream
    // lib/drag.ts uses to move the NSPanel, so a drag near a column edge would
    // be ambiguous. Column widths have no markdown representation anyway.
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder }),
    Markdown.configure({
      // html:true so the Underline mark round-trips as <u> — markdown has no
      // underline syntax, and with html:false tiptap-markdown silently drops
      // it on save (warns "underline mark is only available in html mode").
      html: true,
      bulletListMarker: "-",
      transformPastedText: true,
      transformCopiedText: true,
    }),
    SearchAndReplace.configure({
      searchResultClass: "search-result", // styled in App.css
      disableRegex: true, // FindBar is a literal-text find
    }),
    EditorKeymap,
  ];
}

/**
 * Persisted content is ALWAYS markdown (step 02 contract: getMarkdown(),
 * never getHTML()). tiptap-markdown does not augment TipTap's storage types,
 * hence the local cast.
 */
export function serializeMarkdown(editor: Editor): string {
  return (
    editor.storage as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();
}
