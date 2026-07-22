import { useEffect, useMemo, useRef, useState } from "react";

import { api, type Note } from "../lib/api";
import { rankNotes } from "../lib/fuzzy";

export interface NoteSwitcherProps {
  pins: readonly string[];
  currentNoteId: string | null;
  onOpen: (note: Note) => void;
  /** Delete key on a row — App owns the DELETE call + undo toast. */
  onDelete: (note: Note) => void;
  onClose: () => void;
}

/**
 * ⌘P note switcher (step 06): fuzzy filter over title + content, pinned
 * notes on top, ↑/↓ + Enter opens, Delete deletes (with app-level undo).
 * Esc is handled by the app-level overlay stack.
 *
 * Contents are fetched fresh on every open — the switcher is transient and
 * notes can change under us (file watcher), so no caching.
 */
export default function NoteSwitcher({
  pins,
  currentNoteId,
  onOpen,
  onDelete,
  onClose,
}: NoteSwitcherProps) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const metas = await api.list();
      const loaded = await Promise.all(metas.map((m) => api.read(m.id)));
      if (!cancelled) setNotes(loaded);
    })().catch((e: unknown) => {
      if (!cancelled) setError(`could not load notes: ${e}`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ranked = useMemo(
    () => (notes ? rankNotes(query, notes, pins) : []),
    [notes, query, pins],
  );

  // Clamp selection when the filter shrinks the list.
  const clamped = Math.min(selected, Math.max(ranked.length - 1, 0));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(Math.min(clamped + 1, ranked.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(clamped - 1, 0));
    } else if (event.key === "Enter" && ranked[clamped]) {
      event.preventDefault();
      onOpen(ranked[clamped].note);
    } else if (event.key === "Delete" && ranked[clamped]) {
      // Forward Delete (fn⌫) — plain Backspace keeps editing the query.
      event.preventDefault();
      const target = ranked[clamped].note;
      setNotes((n) => n?.filter((x) => x.id !== target.id) ?? null);
      onDelete(target);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[70%] w-[420px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search notes…"
          className="border-b border-gray-200 px-4 py-3 text-sm outline-none"
        />
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {error && <li className="px-4 py-2 text-xs text-red-600">{error}</li>}
          {!error && notes === null && (
            <li className="px-4 py-2 text-xs text-gray-400">loading…</li>
          )}
          {!error && notes !== null && ranked.length === 0 && (
            <li className="px-4 py-2 text-xs text-gray-400">no matches</li>
          )}
          {ranked.map(({ note, pinned }, index) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => onOpen(note)}
                onMouseEnter={() => setSelected(index)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                  index === clamped ? "bg-blue-50" : ""
                }`}
              >
                {pinned && <span aria-label="pinned">📌</span>}
                <span className="truncate">{note.title}</span>
                {note.id === currentNoteId && (
                  <span className="ml-auto text-xs text-gray-400">current</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-100 px-4 py-1.5 text-[10px] text-gray-400">
          ↑↓ select · Enter open · fn⌫ delete · Esc close
        </div>
      </div>
    </div>
  );
}
