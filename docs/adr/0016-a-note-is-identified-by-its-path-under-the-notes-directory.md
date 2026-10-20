# ADR 0016: A note is identified by its path under the notes directory

- Status: Accepted
- Date: 2026-10-20

## Context

Notes are moving into folders (the Finder-style explorer, prototyped on
`chore/prototype-file-explorer`). Until now a note's id was its filename
without `.md`, and the store refused any id containing `/`. `~/Notes` already
holds 16 subfolders, and filenames repeat across them (`00-index.md`,
`00-PROMPT.md`), so a bare filename can no longer name one note.

## Decision

A note's id is its path relative to the notes directory, without `.md`:
`claude-read-aloud-tts/findings`. A note at the top level keeps the id it has
today, so existing pins, the menubar note and `?note=` links survive with no
migration.

## Considered Options

- **A separate stable id** (frontmatter, or a sidecar map from id to path).
  Survives moves, but breaks the rule that the file is the note: no
  frontmatter, no database row.
- **Filename only, refusing duplicates.** Already impossible: the duplicates
  exist on disk.

## Consequences

Moving or renaming a note changes its id. Whatever moves a note must rewrite
every place the old id is stored (sidecar pins and order, `menuBarNote`, note
history), or those references go stale. A move made outside FloatNotes (Finder,
an agent) reads as one note deleted and another created.
