import { useId, useState } from "react";

export interface PropertiesStripProps {
  /** The raw YAML between the fences. */
  yaml: string;
  /** Fires with the YAML exactly as typed. */
  onChange: (yaml: string) => void;
}

/**
 * A note's front matter (ADR 0018) as a collapsed one-line strip above the
 * editor. Expanding it shows the raw YAML in a plain text box; the strip
 * knows nothing about fences or saving, the editor wires that.
 */
export default function PropertiesStrip({ yaml, onChange }: PropertiesStripProps) {
  const [expanded, setExpanded] = useState(false);
  const boxId = useId();
  const preview = yaml.split("\n").find((line) => line.trim() !== "") ?? "";

  return (
    <div className="mb-2 shrink-0 rounded border border-gray-200 bg-gray-50 text-xs text-gray-600">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={boxId}
        onClick={() => setExpanded((open) => !open)}
        className="floatnotes-focus-inset flex w-full items-center gap-2 rounded border-none bg-transparent px-2 py-1 text-left font-mono text-xs text-gray-600 shadow-none hover:bg-gray-100 focus-visible:bg-gray-100"
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span className="font-sans font-medium">Properties</span>
        {!expanded && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </button>
      {expanded && (
        <textarea
          id={boxId}
          aria-label="Front matter (raw YAML)"
          value={yaml}
          rows={Math.min(Math.max(yaml.split("\n").length, 2), 12)}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className="floatnotes-focus-inset block w-full resize-y border-0 border-t border-gray-200 bg-transparent px-2 py-1 font-mono text-xs text-gray-800"
        />
      )}
    </div>
  );
}
