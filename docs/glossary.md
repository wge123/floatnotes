# Glossary

### Build-mode gate

The assertion that `http://localhost:4949/harness.html` resolves, used as proof
that 4949 is being served by a **debug** build. The server picks its fallback
handler at compile time — debug proxies to Vite, release serves `dist/` from
disk — and the URL alone reveals neither, so this check is a hard precondition
before any audit measurement. See ADR 0008.

### Explorer

The Finder-style view of the notes directory: a folder tree beside a grid of
the current folder, shown as Icons or as Preview cards. It shows notes and
folders only.
_Avoid_: file browser, file tree

### Evidence tagging

The rule that every audit finding carries its source: `measured` (a value a
deterministic tool produced — a computed contrast ratio, a rendered width, a
missing DOM attribute) or `model-judged` (a reviewer's opinion). Model-judged
findings never gate a verdict on their own. See ADR 0006.

### Folder

A directory under the notes directory that holds at least one note, directly
or further down. A directory with no notes anywhere below it is not a folder
and never appears; nor does any dot-directory (`.trash`).
_Avoid_: directory (for the user-facing concept)

### Keyboard reachability

Whether every interactive control can be reached, operated, and left using only
the keyboard, with the focused element visibly indicated at all times. Covers
tab order, focus visibility, focus traps in overlays, and focus restoration when
an overlay closes. The primary axis of the 2026-07 UI/UX audit. See ADR 0006.

### Marker consumption

The v1 editing model: typing a markdown trigger (`# `, `**bold**`, `- `)
converts it to styled content and the raw markers disappear from the editor
view, existing only in the `.md` file on disk. The opposite behavior
(reveal-on-caret) is post-v1. See ADR 0005.

### Menubar note

The one note pinned to the menubar (sidecar `menuBarNote`, ADR 0015). Its
title sits next to the tray icon; a left-click drops a **popover** (a second
window, label `menubar`, running the same app) with that note under the icon.
The popover dismisses when it loses key status; the menu moves to right-click
while a note is pinned. Pin and unpin from ⌘K.

### Note

One plain UTF-8 `.md` file anywhere under `~/Notes` (override
`FLOATNOTES_DIR`), at any folder depth. The file IS the note — no frontmatter,
no database row. Title = first non-empty line (leading `#` stripped). A note's
id is its path under the notes directory without `.md`
(`research/findings`); a top-level note's id is just its filename slug
(ADR 0016). Files that are not `.md` are not notes.

### Private Network Access

The browser gate on requests from a public page to a private/loopback address.
Chrome preflights such requests and expects
`Access-Control-Allow-Private-Network: true`, which the FloatNotes server never
sends, so Chromium blocks them.

**PNA is not a security boundary — it is one browser's courtesy.** The audit's
probe measured WebKit 26.5 and Firefox 153 doing the thing Chromium refuses:
reading the whole notes corpus cross-origin and accepting `POST` / `DELETE`.
Relying on it is what let `Access-Control-Allow-Origin: *` look safe for as long
as it did. The server now runs an origin allowlist instead (`server.rs`
`allowed_origins`), which does not depend on browser behaviour. See ADR 0007.

### Sidecar

`~/Notes/.floatnotes.json` — the single file holding app metadata that must
not live inside notes: pin state, note order, zoom level, Esc behavior
(hide vs unfocus), the menubar note. Never contains note content.

### Trash

`~/Notes/.trash/` — where DELETE renames note files instead of unlinking
them. A note deleted from a folder keeps that folder path inside the trash
(`.trash/work/notes.md`), so it remembers where it came from; the emptied
folder stays on disk. Undo renames back; post-toast recovery is manual. Hidden from the
watcher and the note index like all dotfiles. No auto-expiry. See ADR 0004.

### Undo toast

The 5-second in-app toast shown after destructive actions (currently only
delete). Its action button reverses the operation; its expiry does not make
the operation less recoverable (see Trash).
