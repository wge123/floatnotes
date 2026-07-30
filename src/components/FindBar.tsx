import { useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { SearchAndReplaceStorage } from "@sereneinserenade/tiptap-search-and-replace";

import { trapTab } from "../lib/focus-trap";

export interface FindBarProps {
  editor: TiptapEditor;
  onClose: () => void;
}

function searchStorage(editor: TiptapEditor): SearchAndReplaceStorage {
  return editor.storage.searchAndReplace as SearchAndReplaceStorage;
}

/**
 * ⌘F find-in-note bar (step 06). Drives the search-and-replace extension via
 * the editor ref: term → setSearchTerm, Enter/⇧Enter → next/previous. Esc is
 * handled by the app-level overlay stack (onClose), not here.
 */
export default function FindBar({ editor, onClose }: FindBarProps) {
  const [term, setTerm] = useState("");
  const [counts, setCounts] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const refreshCounts = () => {
    const { results, resultIndex } = searchStorage(editor);
    setCounts({
      current: results.length === 0 ? 0 : resultIndex + 1,
      total: results.length,
    });
  };

  useEffect(() => {
    editor.commands.setSearchTerm(term);
    editor.commands.resetIndex();
    // The plugin computes matches in its own transaction; read afterwards.
    const timer = window.setTimeout(refreshCounts, 30);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, editor]);

  // Clear highlights when the bar closes.
  useEffect(
    () => () => {
      editor.commands.setSearchTerm("");
    },
    [editor],
  );

  const step = (direction: "next" | "previous") => {
    if (direction === "next") {
      editor.commands.nextSearchResult();
    } else {
      editor.commands.previousSearchResult();
    }
    window.setTimeout(refreshCounts, 10);
  };

  return (
    <div
      role="dialog"
      // Deliberately NOT modal: the find bar sits inline under the editor and
      // the editor stays live behind it (matches highlight as you type), so
      // claiming aria-modal="true" would lie to a screen reader.
      aria-modal="false"
      aria-label="Find in note"
      // Non-modal, but Tab still cycles inside the bar (a11y H3): the editor
      // behind it is reachable by click and by Esc, not by tabbing past it.
      onKeyDown={trapTab}
      className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-gray-50 px-3 py-1.5"
    >
      <span className="text-xs font-medium text-gray-500">Find</span>
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? "previous" : "next");
          }
        }}
        // floatnotes-focus-inset: inset focus ring (App.css), matching the
        // other two overlay search fields.
        className="floatnotes-focus-inset flex-1 bg-transparent text-sm"
      />
      <span className="font-mono text-xs text-gray-500">
        {counts.current}/{counts.total}
      </span>
      <button
        type="button"
        onClick={() => step("previous")}
        disabled={counts.total === 0}
        className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-200 focus-visible:bg-gray-200 disabled:opacity-40"
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => step("next")}
        disabled={counts.total === 0}
        className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-200 focus-visible:bg-gray-200 disabled:opacity-40"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-200 focus-visible:bg-gray-200"
        aria-label="Close find"
      >
        ✕
      </button>
    </div>
  );
}
