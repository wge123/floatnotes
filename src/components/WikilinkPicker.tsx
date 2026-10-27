import { useEffect, useRef, useState } from "react";

import type { NoteMeta } from "../lib/api";
import { trapTab } from "../lib/focus-trap";

export interface WikilinkPickerProps {
  /** The notes a wikilink could mean; two or more. */
  candidates: readonly NoteMeta[];
  onOpen: (note: NoteMeta) => void;
  /** Esc is handled by the app-level overlay stack. */
  onClose: () => void;
}

/**
 * Choose between notes that share a wikilink's name. A fixed, short list, so it
 * is its own small dialog rather than the ⌘P switcher, which fetches and
 * searches every note. The id (path) is shown whole: it is what tells them apart.
 */
export default function WikilinkPicker({ candidates, onOpen, onClose }: WikilinkPickerProps) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => listRef.current?.focus(), []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, candidates.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      onOpen(candidates[selected]);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 px-3 pt-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a note"
        onKeyDown={trapTab}
        className="flex max-h-[70%] w-full max-w-[420px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-700">
          Several notes match. Choose one.
        </div>
        <ul
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-label="Matching notes"
          onKeyDown={onKeyDown}
          className="floatnotes-focus-inset min-h-0 flex-1 overflow-auto py-1"
        >
          {candidates.map((note, index) => (
            <li key={note.id} role="option" aria-selected={index === selected}>
              <button
                type="button"
                onClick={() => onOpen(note)}
                onMouseEnter={() => setSelected(index)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                  index === selected ? "bg-blue-50" : ""
                }`}
              >
                <span className="truncate">{note.id}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-100 px-4 py-1.5 text-[10px] text-gray-600">
          ↑↓ select · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
