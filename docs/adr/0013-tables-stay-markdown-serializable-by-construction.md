# ADR 0013: Tables stay markdown-serializable by construction

- Status: Accepted
- Date: 2026-08-03

## Context

Markdown tables rendered as one run-on line of concatenated cell text, because
the editor schema had no table nodes. Both halves of the round-trip already
existed: markdown-it parses pipe tables under the default preset, and
`tiptap-markdown@0.9.0` ships a `table` node spec whose serializer emits pipe
syntax, matched to whichever extension registers a node literally named
`table`. Only the ProseMirror schema was missing.

That serializer has a refusal path. `isMarkdownSerializable()` gives up when
the first row holds a cell that is not a `tableHeader`, when any cell has
`colspan`/`rowspan` > 1, or when any cell holds more than one block. It then
delegates to `HTMLNode`, and because ADR 0005's editor configures
`Markdown({ html: true })` so the Underline mark survives, that delegation does
not error. It silently writes a raw `<table>` blob into a note that is supposed
to be plain markdown, on a filesystem that other tools read (CLAUDE.md: the
filesystem is the source of truth).

Three options were on the table: prevent the unserializable state, allow it and
warn in the status bar, or allow it silently.

## Decision

**Prevent the state.** Every table the UI can produce stays pipe-serializable:

- The insert command always passes `withHeaderRow: true`. Verified: with a
  header row the same insert serializes to `| h |  |\n| --- | --- |\n|  |  |`;
  with `withHeaderRow: false` it serializes to a raw `<table>` blob.
- No merge/split-cell control is exposed, and there is no header-row-off
  toggle, so `colspan`/`rowspan` are unreachable from the UI.
- `Enter` inside a table cell does nothing. It was the one keystroke that
  turned a good table into an HTML blob, by splitting the cell's paragraph in
  two. `Tab`/`Shift-Tab` still move between cells.

Restricting the cell schema to a single paragraph (`TableCell.extend({ content:
"paragraph" })`) was tried first and **rejected**: it does not prevent the
split, it corrupts the table instead. Enter in a cell then splits the *cell*,
so a 2-column table silently became 3 columns, and a pasted two-paragraph cell
was spread across two cells. Cells keep TipTap's default `block+`.

One route into the fallback remains open on purpose: pasting raw `<table>` HTML
with `colspan`. That is HTML in, HTML out, which is the honest result under
`html: true`, and it is locked in by a test so it cannot start failing quietly.

## Consequences

- A table's markdown always has a header row. A "headerless" table is not
  expressible, which is exactly what GitHub-flavored markdown already says.
- **Alignment (`:---`, `:---:`) does not round-trip.** The bundled serializer
  emits `---` unconditionally, so an aligned table read from disk comes back
  left-aligned. Fixing it means replacing the serializer, not configuring it.
- **A table always serializes with a trailing newline**, unlike every other
  block, because the serializer calls `ensureNewLine()` after the last row and
  `getMarkdown()` does not trim. Round-trip tests assert the newline rather
  than pretending it is absent.
- Column widths are not persisted and `resizable` stays off, which also keeps
  the resize plugin off the pointer stream `lib/drag.ts` uses to move the
  NSPanel.
- If merge/split is ever wanted, this ADR is the thing to revisit, and the
  choice at that point is Option B (allow it and surface it in `StatusBar`),
  not silent HTML.
