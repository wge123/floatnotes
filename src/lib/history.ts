/**
 * Visited-note history for ⌘[ / ⌘] (step 06).
 *
 * Immutable browser-style history: visiting truncates the forward tail,
 * back/forward move the cursor without losing entries. Pure and unit-tested;
 * App owns the instance and performs the actual note loads.
 */

export interface NoteHistory {
  readonly ids: readonly string[];
  /** Index into `ids`; -1 only for the empty history. */
  readonly cursor: number;
}

export const emptyHistory: NoteHistory = { ids: [], cursor: -1 };

export function current(history: NoteHistory): string | undefined {
  return history.ids[history.cursor];
}

/** Visit a note: drop the forward tail, append, move the cursor to it. */
export function visit(history: NoteHistory, id: string): NoteHistory {
  if (current(history) === id) return history; // re-open of the same note
  const ids = [...history.ids.slice(0, history.cursor + 1), id];
  return { ids, cursor: ids.length - 1 };
}

export function canGoBack(history: NoteHistory): boolean {
  return history.cursor > 0;
}

export function canGoForward(history: NoteHistory): boolean {
  return history.cursor >= 0 && history.cursor < history.ids.length - 1;
}

export function back(history: NoteHistory): NoteHistory {
  return canGoBack(history)
    ? { ids: history.ids, cursor: history.cursor - 1 }
    : history;
}

export function forward(history: NoteHistory): NoteHistory {
  return canGoForward(history)
    ? { ids: history.ids, cursor: history.cursor + 1 }
    : history;
}

/**
 * A deleted note must stop being reachable via ⌘[/⌘]. Consecutive
 * duplicates left by the removal collapse; the cursor tracks its entry.
 */
export function purge(history: NoteHistory, id: string): NoteHistory {
  const ids: string[] = [];
  let cursor = history.cursor;
  for (let i = 0; i < history.ids.length; i++) {
    const entry = history.ids[i];
    if (entry === id || entry === ids[ids.length - 1]) {
      if (i <= history.cursor) cursor--;
      continue;
    }
    ids.push(entry);
  }
  return { ids, cursor: Math.min(Math.max(cursor, ids.length ? 0 : -1), ids.length - 1) };
}
