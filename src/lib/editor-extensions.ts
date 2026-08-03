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
import { LinkClick } from "./link-click";
import { TaskListInputRule } from "./task-input-rule";

/**
 * `[text](url "Tip")` carries a title, and TipTap's Link mark declares only
 * href/target/rel/class, so the title was dropped on parse and the next save
 * wrote the link back without it. prosemirror-markdown's link serializer
 * already emits a title when the mark has one, so declaring the attribute is
 * the whole fix.
 */
const LinkWithTitle = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

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
    // openOnClick stays false because the caret has to win a plain click inside
    // a contenteditable; LinkClick (below) puts opening behind Cmd-click.
    LinkWithTitle.configure({ openOnClick: false, autolink: true }),
    LinkClick,
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
      // linkify:true is what makes a bare URL sitting in a note file render as
      // a link. `autolink: true` on the Link mark only covers URLs the user
      // TYPES; markdown-it decides what a loaded file's text becomes, and with
      // linkify off (its default) a note full of pasted URLs rendered as plain
      // grey text.
      //
      // The cost, accepted deliberately: this is the one place FloatNotes
      // rewrites a note's markdown rather than preserving it byte for byte.
      // prosemirror-markdown re-emits a linkified URL in its canonical form, so
      // the next save turns `https://x` into `<https://x>`, `www.x` into
      // `[www.x](http://www.x)`, and `a@b.com` into `[a@b.com](mailto:a@b.com)`.
      // Every rewrite is idempotent (round-trip tests cover it) and semantically
      // identical, so a note converges after one save instead of drifting.
      linkify: true,
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
