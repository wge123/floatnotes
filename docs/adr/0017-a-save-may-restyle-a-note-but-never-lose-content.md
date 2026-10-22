# ADR 0017: A save may restyle a note's markdown, but never lose content

- Status: Accepted
- Date: 2026-10-22

The editor writes the whole note on every save, in its own markdown style: a
`*` list comes back as `-`, `__bold__` as `**bold**`, an indented code block
as a fenced one. We accept that restyling. What a save must never do is lose
content: text, images, headings, line breaks, raw HTML, front matter and
links all survive, even when their spelling changes.

## Considered options

- **Untouched text keeps its exact bytes** (Orca's model: diff the edit,
  patch it onto the original file, re-parse to prove the result). Rejected:
  a diff/patch/proof layer on every save is a large, fragile piece of code
  for a scratch-notes app, and restyling is cosmetic once nothing is lost.
- **Never restyle anything**, even edited text. Rejected for the same reason,
  at higher cost.

## Consequences

- The guard is a corpus check, not a byte-preserving save: before an editor
  change ships, a script loads and saves a copy of every real note and
  reports each change by cause. Any change that loses content is a bug.
- Pinned fixture saves (`src/lib/__fixtures__/notes/__saved__/`) record the
  current style, so a restyle is visible as a reviewed diff, never silent.
- A note edited elsewhere (nvim, Obsidian) churns once on its first
  FloatNotes edit, then converges.
- Line breaks inside a paragraph are content, not style: they survive.
