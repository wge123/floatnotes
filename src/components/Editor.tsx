import { useEffect } from "react";
import {
  EditorContent,
  useEditor,
  type Editor as TiptapEditor,
} from "@tiptap/react";

import {
  buildEditorExtensions,
  serializeMarkdown,
} from "../lib/editor-extensions";
import { shouldApplyExternal } from "../lib/external-sync";

export interface EditorProps {
  /** Markdown source of truth (a note's .md content). */
  value: string;
  /** Fires with the full markdown document on every edit. */
  onChange: (markdown: string) => void;
  /** Fires once when the underlying TipTap editor is ready. */
  onReady?: (editor: TiptapEditor) => void;
  placeholder?: string;
}

/**
 * Storage-agnostic markdown editor (step 02). Knows nothing about files,
 * servers, or notes — it maps a markdown string to a live TipTap document and
 * reports edits back as markdown.
 */
export default function Editor({
  value,
  onChange,
  onReady,
  placeholder,
}: EditorProps) {
  const editor = useEditor({
    extensions: buildEditorExtensions(placeholder),
    content: value,
    onCreate: ({ editor }) => onReady?.(editor),
    onUpdate: ({ editor }) => onChange(serializeMarkdown(editor)),
  });

  // External value changes (file watcher, note switch) — guarded so the echo
  // of our own onChange never resets the caret mid-typing.
  useEffect(() => {
    if (!editor) return;
    const current = serializeMarkdown(editor);
    if (shouldApplyExternal(current, value)) {
      editor.commands.setContent(value, false);
    }
  }, [editor, value]);

  return (
    <EditorContent
      editor={editor}
      className="floatnotes-editor prose prose-sm max-w-none"
    />
  );
}
