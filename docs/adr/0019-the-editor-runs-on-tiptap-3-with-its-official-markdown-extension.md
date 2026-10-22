# ADR 0019: The editor runs on TipTap 3 with its official markdown extension

- Status: Accepted
- Date: 2026-10-22

The editor moves from TipTap 2 with the community `tiptap-markdown` 0.9
(markdown-it) to TipTap 3 with the first-party `@tiptap/markdown` (marked),
pinned exactly at 3.31.4. `tiptap-markdown` is unmaintained, and TipTap 3 is
what the studied Orca editor runs on, so its fixes can be lifted rather than
re-derived (study: `~/Developer/Study/.dossiers/stablyai__orca.md`).

## Consequences

- Every extension that hooked markdown-it (empty-task parsing, paste
  conversion) is rebuilt on marked tokenizers, and the abandoned
  search-and-replace plugin is replaced by a local one.
- Style overrides keep today's spelling where TipTap 3 would change it:
  underline stays `<u>`, a bare URL stays `<https://…>`, and intraword
  underscores are not escaped.
- **Supersedes part of ADR 0013.** TipTap 3 writes a multi-paragraph cell
  as `<br>` inside pipe syntax instead of an HTML table, so the Enter guard
  is no longer what keeps tables markdown. Enter in a cell now moves to the
  cell below (cells stay single-line), and table alignment round-trips.
  ADR 0013's header-row and no-merge rules stand.
- Exact pin: upgrading TipTap is a deliberate step that re-runs the corpus
  check (ADR 0017), because the markdown output changes between releases.
