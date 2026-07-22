import SearchAndReplace from "@sereneinserenade/tiptap-search-and-replace";
import type { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { EditorKeymap } from "./editor-keymap";

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
    Placeholder.configure({ placeholder }),
    Markdown.configure({
      html: false,
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
