/**
 * Zoom (step 09): ⌘= / ⌘- / ⌘0 scale the whole UI via the root font-size —
 * every Tailwind/prose size is rem-based, so one CSS property scales
 * everything. The factor persists in the server sidecar (`zoom`), shared
 * across panel + browser surfaces like pins are.
 */

export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

/** :root font-size at zoom 1 (see App.css). */
const BASE_FONT_PX = 16;

/** Clamp to [ZOOM_MIN, ZOOM_MAX] and kill float artifacts (0.1 steps). */
export function clampZoom(zoom: number): number {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return Math.round(clamped * 10) / 10;
}

export function zoomIn(zoom: number): number {
  return clampZoom(zoom + ZOOM_STEP);
}

export function zoomOut(zoom: number): number {
  return clampZoom(zoom - ZOOM_STEP);
}

/** Write the factor to the document root; `null` means default. */
export function applyZoom(zoom: number | null): void {
  const factor = clampZoom(zoom ?? ZOOM_DEFAULT);
  document.documentElement.style.fontSize = `${BASE_FONT_PX * factor}px`;
}
