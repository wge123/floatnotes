import { describe, expect, it, vi } from "vitest";

import { ApiError, ConflictError, type Note } from "./api";
import { saveWithConflictReload } from "./autosave";

const note = (over: Partial<Note> = {}): Note => ({
  id: "hello-abc123",
  title: "Hello",
  content: "# Hello",
  mtime: 1000,
  ...over,
});

describe("auto-save 409 policy (saveWithConflictReload)", () => {
  it("returns the saved note (fresh mtime) on a clean PUT", async () => {
    const saved = note({ mtime: 2000 });
    const api = {
      update: vi.fn().mockResolvedValue(saved),
      read: vi.fn(),
    };

    const outcome = await saveWithConflictReload(
      "hello-abc123",
      "# Hello",
      1000,
      api,
    );

    expect(outcome).toEqual({ kind: "saved", note: saved });
    expect(api.update).toHaveBeenCalledWith("hello-abc123", "# Hello", 1000);
    expect(api.read).not.toHaveBeenCalled();
  });

  it("409 → reloads the disk version and NEVER re-sends the stale content", async () => {
    const diskNote = note({ content: "# Changed on disk", mtime: 3000 });
    const api = {
      update: vi
        .fn()
        .mockRejectedValue(new ConflictError("hello-abc123", 3000)),
      read: vi.fn().mockResolvedValue(diskNote),
    };

    const outcome = await saveWithConflictReload(
      "hello-abc123",
      "# stale local edit",
      1000,
      api,
    );

    expect(outcome).toEqual({ kind: "reloaded", note: diskNote });
    // The write was attempted exactly once — no clobbering retry.
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.read).toHaveBeenCalledWith("hello-abc123");
  });

  it("non-conflict errors are rethrown, not masked as reloads", async () => {
    const api = {
      update: vi.fn().mockRejectedValue(new ApiError(500, "disk full")),
      read: vi.fn(),
    };

    await expect(
      saveWithConflictReload("hello-abc123", "# Hello", 1000, api),
    ).rejects.toThrow(ApiError);
    expect(api.read).not.toHaveBeenCalled();
  });
});
