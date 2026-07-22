import { invoke } from "@tauri-apps/api/core";

/**
 * App-level keymap (step 05; replaces the step-03 panel-keys.ts shim).
 *
 * Escape-layering contract (owned here, S05b overlays consume it): overlays
 * register on a stack; Escape closes the TOP overlay first and hides the
 * panel only when the stack is empty. ⌘W always hides. Editor-scoped chords
 * live in lib/editor-keymap.ts, not here.
 */

export interface OverlayEntry {
  id: string;
  close: () => void;
}

export type KeymapEffect = "none" | "close-top-overlay" | "hide-panel";

export interface ChordLike {
  key: string;
  metaKey: boolean;
}

/** Pure layering reducer — unit-tested; DOM wiring stays in installAppKeymap. */
export function resolveChord(overlayDepth: number, chord: ChordLike): KeymapEffect {
  if (chord.metaKey && chord.key.toLowerCase() === "w") {
    return "hide-panel";
  }
  if (chord.key === "Escape" && !chord.metaKey) {
    return overlayDepth > 0 ? "close-top-overlay" : "hide-panel";
  }
  return "none";
}

// Immutable overlay-stack helpers (a re-pushed id moves to the top).
export function pushOverlay(
  stack: readonly OverlayEntry[],
  entry: OverlayEntry,
): OverlayEntry[] {
  return [...stack.filter((o) => o.id !== entry.id), entry];
}

export function removeOverlay(
  stack: readonly OverlayEntry[],
  id: string,
): OverlayEntry[] {
  return stack.filter((o) => o.id !== id);
}

export function topOverlay(
  stack: readonly OverlayEntry[],
): OverlayEntry | undefined {
  return stack[stack.length - 1];
}

const inTauri = "__TAURI_INTERNALS__" in window;

/** No-op outside the Tauri webview (plain browser at localhost:4949). */
export function hidePanel(): void {
  if (inTauri) {
    void invoke("hide_panel");
  }
}

export interface AppKeymapHandlers {
  overlayDepth: () => number;
  closeTopOverlay: () => void;
}

/** Window-scoped keydown wiring; returns the uninstaller. */
export function installAppKeymap(handlers: AppKeymapHandlers): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    const effect = resolveChord(handlers.overlayDepth(), event);
    if (effect === "none") return;
    event.preventDefault();
    if (effect === "close-top-overlay") {
      handlers.closeTopOverlay();
    } else {
      hidePanel();
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
