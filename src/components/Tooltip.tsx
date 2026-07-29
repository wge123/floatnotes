/**
 * Hover hint for the bottom-bar controls: label plus the chord that runs the
 * same command from the keyboard.
 *
 * CSS-only (group-hover) rather than the native `title` attribute — the OS
 * tooltip waits ~1s and paints system chrome, which reads as sluggish on a
 * floating panel. Anchored to a control edge instead of centred because the
 * app root is `overflow-hidden`, so a centred hint on the first/last control
 * would be clipped.
 */
export interface TooltipProps {
  label: string;
  /** Display chord, e.g. "⇧⌘8". Omitted for controls with no keybinding. */
  shortcut?: string;
  /** Which edge the hint hangs from (default: the control's left edge). */
  align?: "left" | "right";
  /** Above the control (default) or below — the title bar has no room above. */
  side?: "top" | "bottom";
  children: React.ReactNode;
}

export default function Tooltip({
  label,
  shortcut,
  align = "left",
  side = "top",
  children,
}: TooltipProps) {
  return (
    <span className="group/tooltip relative flex shrink-0">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 hidden select-none whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] leading-none text-white shadow-lg group-hover/tooltip:block ${
          align === "right" ? "right-0" : "left-0"
        } ${side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}
      >
        {label}
        {shortcut && (
          <span className="ml-2 font-mono text-gray-400">{shortcut}</span>
        )}
      </span>
    </span>
  );
}
