# ADR 0010: The audit report is standalone; only its manual steps feed back into ux-testing.md

- Status: Accepted
- Date: 2026-07-30

## Context

`docs/ux-testing.md` already exists and already defines an L1/L2/L3 testing ladder
aimed at `http://localhost:4949`, including a manual sweep list ("open :4949 twice;
edits in one appear in the other"). The audit plan was written without reference to it,
and would otherwise have built a parallel structure describing the same surface.

The audit produces two kinds of output with different lifespans. The ranked findings and
the ship/no-ship verdict are a **dated snapshot** — they describe HEAD on 2026-07-30 and
go stale the moment anything is fixed. The "not testable in browser" appendix
(title-bar drag, global ⌥N, window ops, true transparency over wallpaper) is **durable**
— those surfaces will always need manual verification in the real panel, which is
precisely what `docs/ux-testing.md` Level 3 is for.

## Decision

The audit writes `audit-output/REPORT.md` as a standalone, dated artifact holding the
verdict, the ranked findings, and their evidence. Separately, the durable
manual-verification checklist merges into `docs/ux-testing.md`'s Level 3 section.

Nothing else from the report is copied into `ux-testing.md`.

The rejected alternatives: folding everything into `ux-testing.md` gives the best
discoverability but mixes a perishable verdict into a document meant to describe *how*
to test; a standalone report with no feedback leaves the manual steps in an artifact
nobody opens again.

## Consequences

- `docs/ux-testing.md` stays a living how-to-test document and gains real coverage of the
  Tauri-only surface it currently under-specifies.
- The report can be read later as what it is — a point-in-time assessment — without a
  reader wondering which parts are still true.
- Two files must be touched at the end of the audit rather than one, and the split has to
  be judged per finding. The rule is: if it describes *what we found*, it stays in the
  report; if it describes *what someone must check by hand, forever*, it goes to
  `ux-testing.md`.
- A future audit re-run produces a second dated report without conflicting with the
  first, while `ux-testing.md` accumulates improvements rather than duplicates.
