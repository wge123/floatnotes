import { api as defaultApi, ConflictError, type Note } from "./api";

/**
 * Auto-save conflict policy (contract: S05a): on 409 the disk version wins —
 * re-GET the note and report "reloaded" so the UI swaps in the disk content
 * and toasts. The stale content is never re-sent (never clobber disk).
 */

export type SaveOutcome =
  | { kind: "saved"; note: Note }
  | { kind: "reloaded"; note: Note };

export interface SaveApi {
  update(id: string, content: string, mtime: number): Promise<Note>;
  read(id: string): Promise<Note>;
}

export async function saveWithConflictReload(
  id: string,
  content: string,
  mtime: number,
  api: SaveApi = defaultApi,
): Promise<SaveOutcome> {
  try {
    return { kind: "saved", note: await api.update(id, content, mtime) };
  } catch (error) {
    if (error instanceof ConflictError) {
      return { kind: "reloaded", note: await api.read(id) };
    }
    throw error;
  }
}
