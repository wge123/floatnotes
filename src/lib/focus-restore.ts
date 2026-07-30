/**
 * Overlay focus restoration (a11y audit H1).
 *
 * Measured before the fix: closing ⌘P left `BODY` focused (the next Tab
 * restarted from the top of the document — a keyboard user had to reach for
 * the mouse to get back into their note), and ⌘K/⌘F dumped focus on whichever
 * FormatBar button happened to come next in DOM order.
 *
 * The contract is deliberately small: remember what was focused when an
 * overlay opened, put focus back there when it closes, and fall back when
 * "there" no longer exists — ⌘P opening a *different* note remounts the
 * editor under a new key, so the captured node is gone by restore time.
 */

/** Hands focus back to wherever it was when {@link captureFocus} ran. */
export type FocusRestore = () => void;

/**
 * Snapshot the focused element. Call the returned function once, after the
 * DOM has settled (the caller decides when — see App's overlay close path).
 *
 * @param fallback ran when the captured element cannot take focus back:
 *   nothing was focused, the node left the document, or it is not focusable.
 */
export function captureFocus(fallback?: () => void): FocusRestore {
  const previous = document.activeElement;
  return () => {
    if (
      previous instanceof HTMLElement &&
      previous.isConnected &&
      previous !== document.body
    ) {
      previous.focus();
      // focus() is silent on a non-focusable node — verify rather than assume,
      // otherwise a stale capture swallows the fallback.
      if (document.activeElement === previous) return;
    }
    fallback?.();
  };
}

/**
 * Focus the live editing surface inside `host` (the div App renders Editor
 * into). Resolved from the DOM on purpose: TipTap v2 emits `onCreate` on a
 * deferred timer, so a React ref to the editor instance still points at the
 * *destroyed* one for a beat after a note switch remounts it — while the new
 * ProseMirror node is already mounted and focusable.
 */
export function focusEditorSurface(host: HTMLElement | null): void {
  host?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
}
