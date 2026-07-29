/**
 * Manual window drag for the NSPanel (step: titlebar).
 *
 * Tauri's `data-tauri-drag-region` / `startDragging()` no-ops on the
 * nonactivating NSPanel class (performWindowDragWithEvent needs a regular
 * NSWindow's event loop), so the title bar drags the panel by hand: capture
 * the mouse + window origin on mousedown, then setPosition per mousemove.
 */

export interface DragStart {
  /** Window origin at mousedown (physical px). */
  winX: number;
  winY: number;
  /** Mouse at mousedown (logical screen px, e.screenX/Y). */
  screenX: number;
  screenY: number;
}

/**
 * Where the window belongs for the current mouse position (physical px).
 * Screen deltas are logical; the window origin is physical — hence `scale`.
 */
/**
 * Pointer slop (logical px) below which a press-and-release on the title bar
 * counts as a click rather than a drag. A hand never holds perfectly still,
 * so an exact-zero test would make click-to-copy fire only by luck.
 */
export const CLICK_SLOP = 3;

/** True when the pointer stayed within CLICK_SLOP of where it went down. */
export function isClick(
  start: Pick<DragStart, "screenX" | "screenY">,
  screenX: number,
  screenY: number,
): boolean {
  return (
    Math.abs(screenX - start.screenX) <= CLICK_SLOP &&
    Math.abs(screenY - start.screenY) <= CLICK_SLOP
  );
}

export function nextWindowPosition(
  start: DragStart,
  screenX: number,
  screenY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: Math.round(start.winX + (screenX - start.screenX) * scale),
    y: Math.round(start.winY + (screenY - start.screenY) * scale),
  };
}
