/**
 * Typed client for the FloatNotes REST surface (contract: parent plan S03,
 * implemented by src-tauri/src/server.rs + store.rs in step 04).
 *
 * All persistence goes through this module — WebView localStorage NEVER
 * holds note content (multiple WebView instances would silo it).
 */

export interface NoteMeta {
  id: string;
  title: string;
  /** Unix millis of the file on disk — echo it back on PUT. */
  mtime: number;
}

export interface Note extends NoteMeta {
  content: string;
}

/** Mirror of the server's `.floatnotes.json` sidecar (pins/order/zoom). */
export interface Sidecar {
  pins: string[];
  order: string[];
  zoom: number | null;
}

/**
 * PUT carried a stale mtime — the file changed on disk under us. The caller
 * must reload the note (disk wins) and never re-send the stale content.
 */
export class ConflictError extends Error {
  constructor(
    public readonly id: string,
    public readonly serverMtime: number,
  ) {
    super(`mtime conflict for ${id}: server has ${serverMtime}`);
    this.name = "ConflictError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Server origin. When the page is served by the axum server itself
 * (localhost:4949 or a FLOATNOTES_PORT override) the origin IS the API.
 * Inside the Tauri webview the page origin is Vite (dev, port 1420) or
 * tauri://localhost (release) — neither serves the API, so fall back to the
 * server's default address.
 */
export function apiBase(): string {
  const { protocol, port, origin } = window.location;
  if (protocol.startsWith("http") && port !== "1420") return origin;
  return "http://127.0.0.1:4949";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (response.status === 409) {
    const body = (await response.json()) as { id: string; mtime: number };
    throw new ConflictError(body.id, body.mtime);
  }
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  /** Newest first (server sorts by mtime desc). */
  list: (): Promise<NoteMeta[]> => request("/api/notes"),

  create: (content: string): Promise<Note> =>
    request("/api/notes", { method: "POST", body: JSON.stringify({ content }) }),

  read: (id: string): Promise<Note> =>
    request(`/api/notes/${encodeURIComponent(id)}`),

  /** `mtime` = the client's last-known disk mtime; 409 → ConflictError. */
  update: (id: string, content: string, mtime: number): Promise<Note> =>
    request(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ content, mtime }),
    }),

  remove: (id: string): Promise<void> =>
    request(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Undo of `remove` (ADR 0004): renames the note back out of `.trash/`. */
  restore: (id: string): Promise<Note> =>
    request(`/api/notes/${encodeURIComponent(id)}/restore`, { method: "POST" }),

  /** Pins/order/zoom sidecar — shared across panel + browser UIs. */
  sidecarLoad: (): Promise<Sidecar> => request("/api/sidecar"),

  sidecarSave: (sidecar: Sidecar): Promise<void> =>
    request("/api/sidecar", { method: "PUT", body: JSON.stringify(sidecar) }),
};

export type Api = typeof api;
