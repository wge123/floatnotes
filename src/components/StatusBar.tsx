import { useState } from "react";

/** Whitespace-delimited word count over the raw markdown. */
export function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

export interface StatusBarProps {
  markdown: string;
}

/**
 * Bottom status bar (contract: S05a): word/char count, click toggles which
 * one is shown.
 */
export default function StatusBar({ markdown }: StatusBarProps) {
  const [mode, setMode] = useState<"words" | "chars">("words");

  const label =
    mode === "words"
      ? `${countWords(markdown)} words`
      : `${markdown.length} characters`;

  return (
    <div className="flex shrink-0 justify-end border-t border-gray-200 px-3 py-1">
      <button
        type="button"
        onClick={() => setMode((m) => (m === "words" ? "chars" : "words"))}
        className="cursor-pointer border-none bg-transparent p-0 text-xs text-gray-500 shadow-none hover:text-gray-800"
        title="Toggle word/character count"
      >
        {label}
      </button>
    </div>
  );
}
