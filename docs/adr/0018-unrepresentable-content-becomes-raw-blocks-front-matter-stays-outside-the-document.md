# ADR 0018: Content the editor can't represent becomes a raw block; front matter stays outside the document

- Status: Accepted
- Date: 2026-10-22

Real notes hold things the rich editor has no node for: `<details>`, HTML
comments, footnotes, arbitrary HTML, and YAML front matter written by other
tools. Until now the editor dropped them on the first save. We keep them
instead: each becomes a **raw block**, shown read-only as its original text
and saved byte for byte, and front matter is split off before the document is
built, shown in a collapsed properties strip (editable as raw YAML), and
re-attached unchanged on save.

## Considered options

- **Open the whole note as plain text** when it contains anything
  unsupported (Orca's eligibility gate). Rejected: FloatNotes has no source
  mode, and one comment would lock a note out of rich editing.
- **Drop it**, as before. Rejected by ADR 0017: a save never loses content.

## Consequences

- A raw block cannot be edited in the panel; editing its insides is a job
  for an external editor, which the file watcher already propagates.
- A note's title is its first non-empty line *after* any front matter, so
  front-matter notes stop being titled `---`.
- The rendered look of `<details>` (a collapsible section) is not offered;
  it is preserved, not rendered.
