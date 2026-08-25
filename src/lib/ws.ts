/**
 * Live multi-surface sync (step 07): WebSocket client for the server's
 * `/ws` broadcast, plus the pure decision policy for what the app does with
 * each event. NO polling — the socket is the only sync channel; a dropped
 * connection reconnects with jittered backoff.
 *
 * Event contract (src-tauri/src/server.rs `Event`):
 * `{type: "note-changed"|"note-deleted"|"notes-reindexed", id, mtime}`.
 */

import { apiBase } from "./api";

export type SyncEventType = "note-changed" | "note-deleted" | "notes-reindexed";

export interface SyncEvent {
  type: SyncEventType;
  id: string;
  /** Unix millis of the file on disk; null for deletes/reindex. */
  mtime: number | null;
}

// ------------------------------------------------------- decision policy

/** What the app knows about the visible note when an event arrives. */
export interface OpenNoteState {
  id: string;
  /** Last disk mtime the client has applied (from GET/PUT). */
  mtime: number;
  /** Unsaved edits exist (auto-save pending or in flight). */
  dirty: boolean;
}

export type SyncAction =
  | { kind: "ignore" }
  | { kind: "reload"; id: string }
  | { kind: "open-most-recent" };

const IGNORE: SyncAction = { kind: "ignore" };

/**
 * The clean/dirty × mtime decision table (idempotent — replaying an event
 * never changes the outcome):
 *
 * - `note-changed` for another note → ignore (the switcher refetches on open).
 * - `note-changed` with mtime ≤ ours → ignore: it's the echo of our own save
 *   (the PUT response already carried that mtime) or a replay. Dedupe here is
 *   what makes silent reloads not fight the auto-save loop.
 * - `note-changed`, newer mtime, clean editor → reload (disk wins silently;
 *   the Editor caret guard applies only genuinely different content).
 * - `note-changed`, newer mtime, dirty editor → ignore: the user keeps
 *   typing; the next auto-save PUTs a stale mtime and the 409 path resolves
 *   the conflict (autosave.ts — disk wins there, never here).
 * - `note-deleted` for the open note → open the most recent survivor + toast.
 * - `notes-reindexed` → reload the open note when clean. The server only sends
 *   this when it KNOWS it has lost events (a lagging socket, a watch error, a
 *   dead watcher), so the mtime protocol has nothing to compare against and
 *   ignoring it leaves the panel quietly stale. Dirty still yields to the 409
 *   path, which is the only place unsaved edits are resolved.
 */
export function decideSyncAction(
  event: SyncEvent,
  open: OpenNoteState | null,
): SyncAction {
  if (!open) return IGNORE;
  switch (event.type) {
    case "note-changed": {
      if (event.id !== open.id) return IGNORE;
      if (event.mtime === null || event.mtime <= open.mtime) return IGNORE;
      if (open.dirty) return IGNORE;
      return { kind: "reload", id: open.id };
    }
    case "note-deleted":
      return event.id === open.id ? { kind: "open-most-recent" } : IGNORE;
    case "notes-reindexed":
      return open.dirty ? IGNORE : { kind: "reload", id: open.id };
  }
}

// ------------------------------------------------------------- transport

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 10_000;

/**
 * Equal-jitter backoff: ceiling doubles per attempt (capped), delay is a
 * random point in [ceiling/2, ceiling) — guaranteed non-zero so a dead
 * server never gets hammered in a tight loop.
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.floor(ceiling / 2 + (random() * ceiling) / 2);
}

/** `http(s)://host` → `ws(s)://host/ws` (same origin rules as apiBase). */
export function wsUrl(base: string = apiBase()): string {
  return `${base.replace(/^http/, "ws")}/ws`;
}

export interface SyncSocket {
  close(): void;
}

/**
 * Open the sync socket and keep it open: reconnects forever with jittered
 * backoff (reset on a successful open) until `close()` is called. Malformed
 * frames are logged and dropped — one bad message must not kill the channel.
 */
export function connectSync(
  onEvent: (event: SyncEvent) => void,
  url: string = wsUrl(),
): SyncSocket {
  let attempt = 0;
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let closed = false;

  const open = () => {
    if (closed) return;
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (message: MessageEvent<string>) => {
      let event: SyncEvent;
      try {
        event = JSON.parse(message.data) as SyncEvent;
      } catch (error) {
        console.warn("[floatnotes] unparseable ws frame:", error);
        return;
      }
      onEvent(event);
    };
    // onerror always precedes onclose; scheduling lives in onclose only.
    socket.onclose = () => {
      socket = null;
      if (closed) return;
      timer = window.setTimeout(open, backoffDelay(attempt++));
    };
  };

  open();

  return {
    close() {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
    },
  };
}
