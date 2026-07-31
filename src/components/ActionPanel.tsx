import { useEffect, useMemo, useRef, useState } from "react";

import { trapTab } from "../lib/focus-trap";
import { fuzzyScore } from "../lib/fuzzy";

export interface Action {
  id: string;
  label: string;
  /** Rendered right-aligned, e.g. "⌘N". */
  shortcut?: string;
  run: () => void;
}

export interface ActionPanelProps {
  actions: readonly Action[];
  onClose: () => void;
}

/**
 * ⌘K action panel (step 06): a filterable command list. The actions
 * themselves (New, Duplicate, Pin, …) are declared by App — this component
 * only filters and runs them. Esc is handled by the app-level overlay stack.
 *
 * Anatomy is deliberately identical to `NoteSwitcher` (audit M5): input on
 * top, scrolling list, keyboard-hint footer. ⌘P and ⌘K are one keystroke
 * apart, so mirroring their layouts made them read as spatial opposites.
 */
export default function ActionPanel({ actions, onClose }: ActionPanelProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    if (query.trim() === "") return [...actions];
    return actions
      .map((action) => ({ action, score: fuzzyScore(query, action.label) }))
      .filter((x): x is { action: Action; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.action);
  }, [actions, query]);

  const clamped = Math.min(selected, Math.max(filtered.length - 1, 0));

  const run = (action: Action) => {
    onClose(); // close first — actions may open another overlay (Find, Browse)
    action.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(Math.min(clamped + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(clamped - 1, 0));
    } else if (event.key === "Enter" && filtered[clamped]) {
      event.preventDefault();
      run(filtered[clamped]);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-end bg-black/10 p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Actions"
        onKeyDown={trapTab}
        className="flex max-h-[60%] w-[300px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search actions…"
          // floatnotes-focus-inset: inset focus ring (App.css) — an outset one
          // is clipped by the overlay's rounded, overflow-hidden corner.
          className="floatnotes-focus-inset border-b border-gray-200 px-3 py-2 text-sm"
        />
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-gray-500">no actions</li>
          )}
          {filtered.map((action, index) => (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => run(action)}
                onMouseEnter={() => setSelected(index)}
                className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${
                  index === clamped ? "bg-blue-50" : ""
                }`}
              >
                <span>{action.label}</span>
                {action.shortcut && (
                  <span
                    // gray-600, not gray-500: this hint rides the row, and the
                    // selected row is bg-blue-50, where gray-500 measures only
                    // 4.44:1 (sub-AA). gray-600 is 6.94:1 there, 7.56:1 on white.
                    className="ml-auto font-mono text-[10px] text-gray-600"
                  >
                    {action.shortcut}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div
          // gray-600 to match the switcher's hint: gray-500 clears AA on white
          // (4.84:1) but only just, and this is the smallest text in the app.
          className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-600"
        >
          ↑↓ select · Enter run · Esc close
        </div>
      </div>
    </div>
  );
}
