import { invoke } from "@tauri-apps/api/core";

/**
 * App-level keymap (steps 05–06).
 *
 * Escape-layering contract (owned here, overlays consume it): overlays
 * register on a stack; Escape closes the TOP overlay first and hides the
 * panel only when the stack is empty. ⌘W always hides. Editor-scoped chords
 * live in lib/editor-keymap.ts, not here.
 *
 * Step 06 chords: ⌘N new · ⌘P switcher · ⇧⌘P pin · ⌘1–9 pinned jump
 * (⌘0 reserved for zoom, step 09) · ⌘[/⌘] history · ⌘K actions · ⌘F find.
 */

export interface OverlayEntry {
  id: string;
  close: () => void;
}

export type KeymapEffect =
  | { kind: "none" }
  | { kind: "close-top-overlay" }
  | { kind: "hide-panel" }
  | { kind: "new-note" }
  | { kind: "toggle-switcher" }
  | { kind: "toggle-pin" }
  /** 0-based index into the pinned list (⌘1 → 0 … ⌘9 → 8). */
  | { kind: "pinned-jump"; index: number }
  /** ⌘0 — reserved; zoom lands in step 09. */
  | { kind: "zoom-reset" }
  | { kind: "history-back" }
  | { kind: "history-forward" }
  | { kind: "action-panel" }
  | { kind: "find" };

export type AppCommand = Exclude<
  KeymapEffect,
  { kind: "none" } | { kind: "close-top-overlay" } | { kind: "hide-panel" }
>;

export interface ChordLike {
  key: string;
  metaKey: boolean;
  shiftKey?: boolean;
}

/** Pure chord resolver — unit-tested; DOM wiring stays in installAppKeymap. */
export function resolveChord(
  overlayDepth: number,
  chord: ChordLike,
): KeymapEffect {
  if (chord.key === "Escape" && !chord.metaKey) {
    return overlayDepth > 0
      ? { kind: "close-top-overlay" }
      : { kind: "hide-panel" };
  }
  if (!chord.metaKey) return { kind: "none" };

  const key = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key;
  if (chord.shiftKey) {
    // Only one shifted app chord exists; the rest stay untouched (e.g.
    // ⇧⌘Z redo belongs to the editor).
    return key === "p" ? { kind: "toggle-pin" } : { kind: "none" };
  }
  switch (key) {
    case "w":
      return { kind: "hide-panel" };
    case "n":
      return { kind: "new-note" };
    case "p":
      return { kind: "toggle-switcher" };
    case "k":
      return { kind: "action-panel" };
    case "f":
      return { kind: "find" };
    case "[":
      return { kind: "history-back" };
    case "]":
      return { kind: "history-forward" };
    case "0":
      return { kind: "zoom-reset" };
    default:
      if (key >= "1" && key <= "9") {
        return { kind: "pinned-jump", index: Number(key) - 1 };
      }
      return { kind: "none" };
  }
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
  /** Every non-layering command (⌘N/⌘P/⌘K/…) lands here. */
  onCommand: (command: AppCommand) => void;
}

/** Window-scoped keydown wiring; returns the uninstaller. */
export function installAppKeymap(handlers: AppKeymapHandlers): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    const effect = resolveChord(handlers.overlayDepth(), event);
    if (effect.kind === "none") return;
    event.preventDefault();
    if (effect.kind === "close-top-overlay") {
      handlers.closeTopOverlay();
    } else if (effect.kind === "hide-panel") {
      hidePanel();
    } else {
      handlers.onCommand(effect);
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
