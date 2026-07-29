import type { Editor } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";

/**
 * ⌘A yields an AllSelection, from which ProseMirror can't compute a lift target
 * (the range boundaries are the doc edges) — so lift-based toggles (blockquote,
 * bullet/ordered/task list) wrap but won't un-wrap. Coerce it to an explicit
 * full-document text selection first; then toggleX can lift back out. Marks and
 * codeBlock don't lift, so they never hit this and don't need the coercion.
 */
function liftableChain(editor: Editor) {
  const chain = editor.chain().focus();
  if (editor.state.selection instanceof AllSelection) {
    chain.setTextSelection({ from: 0, to: editor.state.doc.content.size });
  }
  return chain;
}

/**
 * Format-toolbar command table (Raycast-parity bottom bar).
 *
 * Pure data over the live editor: each entry knows how to run its command and
 * whether it is active at the current selection. Components render this table;
 * tests drive it against a headless editor — neither hard-codes TipTap calls.
 */
export interface FormatCommand {
  id: string;
  /** Accessible name, doubles as the hover tooltip. */
  label: string;
  /**
   * Display form of the chord that runs this command (⌘/⌥/⇧ glyphs, macOS
   * order ⌃⌥⇧⌘). Must mirror lib/editor-keymap.ts — the keymap is what
   * actually fires; this is only what the tooltip shows.
   */
  shortcut: string;
  run: (editor: Editor) => void;
  isActive: (editor: Editor) => boolean;
}

/** Chord for the ⌘L link toggle — owned by the keymap, shown by the toolbar. */
export const LINK_SHORTCUT = "⌘L";

export const HEADING_LEVELS = [1, 2, 3] as const;

export function headingCommand(level: 1 | 2 | 3): FormatCommand {
  return {
    id: `h${level}`,
    label: `Heading ${level}`,
    shortcut: `⌥⌘${level}`,
    run: (editor) =>
      editor.chain().focus().toggleHeading({ level }).run(),
    isActive: (editor) => editor.isActive("heading", { level }),
  };
}

/** True when the caret sits in any heading — lights the H trigger itself. */
export function inAnyHeading(editor: Editor): boolean {
  return editor.isActive("heading");
}

/**
 * The mark/block commands in toolbar order (headings live behind the H
 * popover, see headingCommand).
 */
export const FORMAT_COMMANDS: readonly FormatCommand[] = [
  {
    id: "bold",
    label: "Bold",
    shortcut: "⌘B",
    run: (editor) => editor.chain().focus().toggleBold().run(),
    isActive: (editor) => editor.isActive("bold"),
  },
  {
    id: "italic",
    label: "Italic",
    shortcut: "⌘I",
    run: (editor) => editor.chain().focus().toggleItalic().run(),
    isActive: (editor) => editor.isActive("italic"),
  },
  {
    id: "strike",
    label: "Strikethrough",
    shortcut: "⇧⌘S",
    run: (editor) => editor.chain().focus().toggleStrike().run(),
    isActive: (editor) => editor.isActive("strike"),
  },
  {
    id: "underline",
    label: "Underline",
    shortcut: "⌘U",
    run: (editor) => editor.chain().focus().toggleUnderline().run(),
    isActive: (editor) => editor.isActive("underline"),
  },
  {
    id: "code",
    label: "Code",
    shortcut: "⌘E",
    run: (editor) => editor.chain().focus().toggleCode().run(),
    isActive: (editor) => editor.isActive("code"),
  },
  {
    id: "blockquote",
    label: "Quote",
    shortcut: "⇧⌘B",
    run: (editor) => liftableChain(editor).toggleBlockquote().run(),
    isActive: (editor) => editor.isActive("blockquote"),
  },
  {
    id: "code-block",
    label: "Code Block",
    shortcut: "⌥⌘C",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    isActive: (editor) => editor.isActive("codeBlock"),
  },
  {
    id: "ordered-list",
    label: "Numbered List",
    shortcut: "⇧⌘7",
    run: (editor) => liftableChain(editor).toggleOrderedList().run(),
    isActive: (editor) => editor.isActive("orderedList"),
  },
  {
    id: "bullet-list",
    label: "Bullet List",
    shortcut: "⇧⌘8",
    run: (editor) => liftableChain(editor).toggleBulletList().run(),
    isActive: (editor) => editor.isActive("bulletList"),
  },
  {
    id: "task-list",
    label: "Task List",
    shortcut: "⇧⌘9",
    run: (editor) => liftableChain(editor).toggleTaskList().run(),
    isActive: (editor) => editor.isActive("taskList"),
  },
];

/**
 * Toggle a link on the current selection: active link → remove; otherwise ask
 * for a URL via `promptUrl` (component passes window.prompt; tests stub it).
 * Empty/cancelled input is a no-op.
 */
export function toggleLink(
  editor: Editor,
  promptUrl: () => string | null,
): void {
  if (editor.isActive("link")) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const url = promptUrl()?.trim();
  if (!url) return;
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}
