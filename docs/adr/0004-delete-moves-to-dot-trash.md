# ADR 0004: Delete moves notes to ~/Notes/.trash, never unlinks

- Status: Accepted
- Date: 2026-07-22

## Context

S05b's switcher deletes with a 5-second undo toast and no confirm dialog. The
blueprint never said what the server's `DELETE /api/notes/:id` does after the
toast expires; the implied `unlink` makes one mis-tap permanently destroy a
plain-text file — at odds with the files-first philosophy that made `.md`
files the source of truth.

## Decision

We will implement DELETE as a rename into `~/Notes/.trash/` (created on
demand). Undo renames the file back; after the toast, recovery is a manual
drag out of `.trash/`. No trash-browsing UI is built. The macOS system trash
and permanent-unlink alternatives were rejected: the former adds a Tauri
command hop for the server path, the latter loses data on a missed toast.

## Consequences

- No user action inside FloatNotes can irreversibly destroy note content;
  worst case is a file sitting in a hidden folder.
- The watcher/indexer must ignore `.trash/` — already covered by S03's
  "ignore the sidecar and dotfiles" rule, but the store's list operation must
  not recurse into it either.
- Trashed filenames may collide on repeated delete/restore of same-titled
  notes; the store appends a timestamp suffix on collision.
- `.trash/` grows unboundedly by design (plain files, user-prunable); no
  auto-expiry in v1.
