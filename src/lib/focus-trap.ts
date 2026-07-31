import type { KeyboardEvent } from "react";

/**
 * Overlay focus trap (a11y audit H3).
 *
 * Measured before the fix: one Tab out of ⌘K's or ⌘F's input landed on the
 * FormatBar buttons *behind* the overlay (`audit-output/a11y/a11y-raw.md` —
 * "focus trapped: NO — focus leaks to the page beneath"). ⌘P read as trapped
 * only because the probe pressed Tab six times against 26+ note rows.
 *
 * The trap is deliberately edge-only: while Tab has somewhere to go inside the
 * overlay we let the browser move focus itself (it knows about visibility,
 * shadow roots and platform tab-order rules better than a selector does), and
 * we intervene solely at the ends to wrap around.
 *
 * Trapping is chosen over `inert` on the background because it is the same
 * mechanism for all three overlays — including the ⌘F bar, which is
 * deliberately non-modal (the editor behind it stays live and highlights
 * matches as you type, see H2) and so must NOT make the page inert. Cycling
 * Tab inside a find widget while leaving the background reachable by click and
 * by screen reader is exactly what a non-modal dialog should do.
 */

/**
 * What a Tab press can land on. Two exclusions carry weight:
 * `:not([disabled])` — FindBar's ↑/↓ buttons are disabled until a term
 * matches, and a disabled control is not a tab stop, so wrapping onto one
 * would drop focus on the floor; and `:not([tabindex="-1"])` on every arm,
 * because an opted-out control (`<button tabindex="-1">`) still matches its
 * bare tag selector while the browser skips it — the trap's stop list has to
 * agree with the tab order it is closing the ends of.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
  '[contenteditable="true"]',
]
  .map((arm) => `${arm}:not([tabindex="-1"])`)
  .join(", ");

/** Tab stops inside `container`, in document order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * Where a Tab press must be redirected to keep focus inside `container`.
 *
 * `null` means "don't interfere" — either the overlay has no tab stops at all,
 * or the browser's own next stop is still inside.
 *
 * @param active what currently holds focus (`document.activeElement`).
 * @param backwards ⇧Tab.
 */
export function trapTarget(
  container: HTMLElement,
  active: Element | null,
  backwards: boolean,
): HTMLElement | null {
  const stops = focusableWithin(container);
  if (stops.length === 0) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];

  const index = active instanceof HTMLElement ? stops.indexOf(active) : -1;
  // Focus sits on the overlay shell rather than a stop inside it — pull it to
  // the edge Tab would have reached.
  if (index === -1) return backwards ? last : first;

  if (backwards) return index === 0 ? last : null;
  return index === stops.length - 1 ? first : null;
}

/**
 * `onKeyDown` for an overlay's dialog element: keeps Tab / ⇧Tab cycling within
 * it. Attach to the dialog, not the scrim — Tab events bubble up from whatever
 * inside holds focus.
 */
export function trapTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const target = trapTarget(
    event.currentTarget,
    document.activeElement,
    event.shiftKey,
  );
  if (!target) return;
  event.preventDefault();
  target.focus();
}
