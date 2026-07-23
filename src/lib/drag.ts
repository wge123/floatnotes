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
