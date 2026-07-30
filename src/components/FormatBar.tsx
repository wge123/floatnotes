import { Fragment, useEffect, useReducer, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";

import {
  FORMAT_COMMANDS,
  HEADING_LEVELS,
  headingCommand,
  inAnyHeading,
  LINK_SHORTCUT,
  toggleLink,
  type FormatCommand,
} from "../lib/format";
import Tooltip from "./Tooltip";

/** Raycast-style glyphs for each command id (label stays the tooltip). */
const GLYPHS: Record<string, string> = {
  bold: "B",
  italic: "I",
  strike: "S",
  underline: "U",
  code: "<>",
  blockquote: "”", // ”
  "code-block": "{ }",
  "ordered-list": "1.",
  "bullet-list": "•–", // •–
  "task-list": "☑", // ☑
};

const GLYPH_CLASSES: Record<string, string> = {
  bold: "font-bold",
  italic: "italic",
  strike: "line-through",
  underline: "underline",
};

interface FormatButtonProps {
  label: string;
  /** Display chord shown in the hover hint, e.g. "⌘B". */
  shortcut?: string;
  active: boolean;
  onRun: () => void;
  children: React.ReactNode;
}

function FormatButton({
  label,
  shortcut,
  active,
  onRun,
  children,
}: FormatButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        aria-pressed={active}
        // Keep the editor selection: mousedown would steal focus before click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRun}
        className={`flex h-6 min-w-6 items-center justify-center rounded border-none px-1 font-mono text-xs shadow-none ${
          active
            ? "bg-gray-200 text-gray-900"
            : "bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:bg-gray-100 focus-visible:text-gray-800"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export interface FormatBarProps {
  editor: TiptapEditor;
}

/**
 * Bottom formatting toolbar (Raycast parity): H popover + marks/blocks from
 * the FORMAT_COMMANDS table. Re-renders on every editor transaction so active
 * states track the caret.
 */
export default function FormatBar({ editor }: FormatBarProps) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    editor.on("transaction", forceRender);
    return () => {
      editor.off("transaction", forceRender);
    };
  }, [editor]);

  // Click anywhere outside the H popover closes it.
  useEffect(() => {
    if (!headingsOpen) return;
    const close = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) {
        setHeadingsOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [headingsOpen]);

  const runCommand = (cmd: FormatCommand) => {
    cmd.run(editor);
  };

  return (
    <div className="flex items-center gap-0.5">
      <div ref={popoverRef} className="relative">
        <FormatButton
          label="Heading"
          // The trigger is a popover, not one chord — name the range it opens.
          shortcut="⌥⌘1–3"
          active={inAnyHeading(editor)}
          onRun={() => setHeadingsOpen((open) => !open)}
        >
          H<span className="ml-0.5 text-[8px]">▾</span>
        </FormatButton>
        {headingsOpen && (
          <div className="absolute bottom-8 left-0 z-40 flex gap-0.5 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {HEADING_LEVELS.map((level) => {
              const cmd = headingCommand(level);
              return (
                <FormatButton
                  key={cmd.id}
                  label={cmd.label}
                  shortcut={cmd.shortcut}
                  active={cmd.isActive(editor)}
                  onRun={() => {
                    runCommand(cmd);
                    setHeadingsOpen(false);
                  }}
                >
                  H{level}
                </FormatButton>
              );
            })}
          </div>
        )}
      </div>
      {FORMAT_COMMANDS.map((cmd) => (
        <Fragment key={cmd.id}>
          <FormatButton
            label={cmd.label}
            shortcut={cmd.shortcut}
            active={cmd.isActive(editor)}
            onRun={() => runCommand(cmd)}
          >
            <span className={GLYPH_CLASSES[cmd.id] ?? ""}>
              {GLYPHS[cmd.id] ?? cmd.id}
            </span>
          </FormatButton>
          {/* Raycast order: the link button sits right after inline code. */}
          {cmd.id === "code" && (
            <FormatButton
              label="Link"
              shortcut={LINK_SHORTCUT}
              active={editor.isActive("link")}
              onRun={() => toggleLink(editor, () => window.prompt("Link URL"))}
            >
              🔗
            </FormatButton>
          )}
        </Fragment>
      ))}
    </div>
  );
}
