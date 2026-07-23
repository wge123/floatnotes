import { useState } from "react";

/** Whitespace-delimited word count over the raw markdown. */
export function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

export interface StatusBarProps {
  markdown: string;
}

/**
 * Word/char count (contract: S05a), click toggles which one is shown.
 * Renders bare — App's bottom bar owns the container (count sits right of
 * the format toolbar).
 */
export default function StatusBar({ markdown }: StatusBarProps) {
  const [mode, setMode] = useState<"words" | "chars">("words");

  const label =
    mode === "words"
      ? `${countWords(markdown)} words`
      : `${markdown.length} characters`;

  return (
    <button
      type="button"
      onClick={() => setMode((m) => (m === "words" ? "chars" : "words"))}
      className="shrink-0 cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-xs text-gray-500 shadow-none hover:text-gray-800"
      title="Toggle word/character count"
    >
      {label}
    </button>
  );
}
