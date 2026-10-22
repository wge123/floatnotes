import { useEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
  type Editor as TiptapEditor,
} from "@tiptap/react";

import {
  buildEditorExtensions,
  loadNote,
  saveNote,
} from "../lib/editor-extensions";
import { shouldApplyExternal } from "../lib/external-sync";
import { type FrontMatter, withYaml } from "../lib/front-matter";
import PropertiesStrip from "./PropertiesStrip";

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
  // Front matter is split off here and written back unchanged on every save
  // (ADR 0018). The ref is what handlers read; the state re-renders the strip.
  const [loaded] = useState(() => loadNote(value));
  const frontMatterRef = useRef<FrontMatter | null>(loaded.frontMatter);
  const [frontMatter, setFrontMatter] = useState(loaded.frontMatter);

  const editor = useEditor({
    extensions: buildEditorExtensions(placeholder),
    content: loaded.content,
    // A bare string is HTML in TipTap 3.
    contentType: "markdown",
    onCreate: ({ editor }) => onReady?.(editor),
    onUpdate: ({ editor }) =>
      onChange(saveNote(editor, frontMatterRef.current)),
  });

  // External value changes (file watcher, note switch) — guarded so the echo
  // of our own onChange never resets the caret mid-typing.
  useEffect(() => {
    if (!editor) return;
    const current = saveNote(editor, frontMatterRef.current);
    if (shouldApplyExternal(current, value)) {
      const next = loadNote(value);
      frontMatterRef.current = next.frontMatter;
      setFrontMatter(next.frontMatter);
      // Markdown, not HTML, and no update event: a reload is not an edit, so
      // it must not write the note back.
      editor.commands.setContent(next.content, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }, [editor, value]);

  const editYaml = (yaml: string) => {
    if (!editor || !frontMatterRef.current) return;
    const next = withYaml(frontMatterRef.current, yaml);
    frontMatterRef.current = next;
    setFrontMatter(next);
    onChange(saveNote(editor, next));
  };

  return (
    <>
      {frontMatter && (
        <PropertiesStrip yaml={frontMatter.yaml} onChange={editYaml} />
      )}
      <EditorContent
        editor={editor}
        className="floatnotes-editor prose prose-sm max-w-none"
      />
    </>
  );
}
