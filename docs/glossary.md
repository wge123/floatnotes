# Glossary

### Marker consumption

The v1 editing model: typing a markdown trigger (`# `, `**bold**`, `- `)
converts it to styled content and the raw markers disappear from the editor
view, existing only in the `.md` file on disk. The opposite behavior
(reveal-on-caret) is post-v1. See ADR 0005.

### Note

One plain UTF-8 `.md` file in `~/Notes` (override `FLOATNOTES_DIR`). The file
IS the note — no frontmatter, no database row. Title = first non-empty line
(leading `#` stripped); filename = title slug + short random suffix, stable
after creation.

### Sidecar

`~/Notes/.floatnotes.json` — the single file holding app metadata that must
not live inside notes: pin state, note order, zoom level. Never contains note
content.

### Trash

`~/Notes/.trash/` — where DELETE renames note files instead of unlinking
them. Undo renames back; post-toast recovery is manual. Hidden from the
watcher and the note index like all dotfiles. No auto-expiry. See ADR 0004.

### Undo toast

The 5-second in-app toast shown after destructive actions (currently only
delete). Its action button reverses the operation; its expiry does not make
the operation less recoverable (see Trash).
