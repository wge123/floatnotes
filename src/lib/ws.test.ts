import { describe, expect, it } from "vitest";

import {
  backoffDelay,
  decideSyncAction,
  wsUrl,
  type OpenNoteState,
  type SyncEvent,
} from "./ws";

const open = (over: Partial<OpenNoteState> = {}): OpenNoteState => ({
  id: "hello-abc123",
  mtime: 1000,
  dirty: false,
  ...over,
});

const changed = (mtime: number | null, id = "hello-abc123"): SyncEvent => ({
  type: "note-changed",
  id,
  mtime,
});

describe("decideSyncAction — clean/dirty × mtime decision table", () => {
  // The spec table: rows are (editor state, event mtime vs known mtime).
  it.each([
    // [label, dirty, eventMtime, expectedKind]
    ["clean + newer mtime → silent reload", false, 2000, "reload"],
    ["clean + equal mtime (own-save echo) → ignore", false, 1000, "ignore"],
    ["clean + older mtime (replay) → ignore", false, 999, "ignore"],
    ["dirty + newer mtime → ignore (409 resolves)", true, 2000, "ignore"],
    ["dirty + equal mtime → ignore", true, 1000, "ignore"],
    ["dirty + older mtime → ignore", true, 999, "ignore"],
  ] as const)("%s", (_label, dirty, mtime, expected) => {
    const action = decideSyncAction(changed(mtime), open({ dirty }));
    expect(action.kind).toBe(expected);
  });

  it("reload targets the open note id", () => {
    expect(decideSyncAction(changed(2000), open())).toEqual({
      kind: "reload",
      id: "hello-abc123",
    });
  });

  it("note-changed for a DIFFERENT note is ignored, even when clean+newer", () => {
    expect(decideSyncAction(changed(2000, "other-xyz"), open()).kind).toBe(
      "ignore",
    );
  });

  it("note-changed with null mtime is ignored (cannot dedupe)", () => {
    expect(decideSyncAction(changed(null), open()).kind).toBe("ignore");
  });

  it("is idempotent — replaying the same event yields the same action", () => {
    const event = changed(2000);
    const first = decideSyncAction(event, open());
    const again = decideSyncAction(event, open());
    expect(again).toEqual(first);
    // ...and once the reload applied (mtime advanced), the replay is a no-op.
    expect(decideSyncAction(event, open({ mtime: 2000 })).kind).toBe("ignore");
  });

  it("note-deleted for the open note → open-most-recent (dirty or clean)", () => {
    const event: SyncEvent = {
      type: "note-deleted",
      id: "hello-abc123",
      mtime: null,
    };
    expect(decideSyncAction(event, open()).kind).toBe("open-most-recent");
    expect(decideSyncAction(event, open({ dirty: true })).kind).toBe(
      "open-most-recent",
    );
  });

  it("note-deleted for another note is ignored", () => {
    const event: SyncEvent = { type: "note-deleted", id: "other", mtime: null };
    expect(decideSyncAction(event, open()).kind).toBe("ignore");
  });

  // The server sends this only when it KNOWS it lost events (lagging socket,
  // watch error, dead watcher). Ignoring it left the open note silently stale
  // with nothing to compare mtimes against.
  it("notes-reindexed reloads the open note when it is clean", () => {
    const event: SyncEvent = {
      type: "notes-reindexed",
      id: "",
      mtime: null,
    };
    expect(decideSyncAction(event, open())).toEqual({
      kind: "reload",
      id: "hello-abc123",
    });
  });

  it("notes-reindexed is ignored while the editor is dirty", () => {
    const event: SyncEvent = {
      type: "notes-reindexed",
      id: "",
      mtime: null,
    };
    expect(decideSyncAction(event, open({ dirty: true })).kind).toBe("ignore");
  });

  it("no open note → every event is ignored", () => {
    expect(decideSyncAction(changed(2000), null).kind).toBe("ignore");
    expect(
      decideSyncAction(
        { type: "note-deleted", id: "x", mtime: null },
        null,
      ).kind,
    ).toBe("ignore");
  });
});

describe("backoffDelay — jittered, capped, never zero", () => {
  it("stays within [ceiling/2, ceiling) for the attempt", () => {
    // attempt 0 → ceiling 500, attempt 2 → ceiling 2000
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(0, () => 0.999999)).toBeLessThan(500);
    expect(backoffDelay(2, () => 0)).toBe(1000);
    expect(backoffDelay(2, () => 0.999999)).toBeLessThan(2000);
  });

  it("caps at 10s regardless of attempt count", () => {
    expect(backoffDelay(50, () => 0.999999)).toBeLessThan(10_000);
    expect(backoffDelay(50, () => 0)).toBe(5000);
  });

  it("is never zero (no tight reconnect loop)", () => {
    expect(backoffDelay(0, () => 0)).toBeGreaterThan(0);
  });
});

describe("wsUrl", () => {
  it("maps the http api base to the ws endpoint", () => {
    expect(wsUrl("http://127.0.0.1:4949")).toBe("ws://127.0.0.1:4949/ws");
  });

  it("maps https to wss", () => {
    expect(wsUrl("https://example.test")).toBe("wss://example.test/ws");
  });
});
