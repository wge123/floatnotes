# ADR 0009: Audit tooling is committed; Playwright stays out of package.json

- Status: Accepted
- Date: 2026-07-30

## Context

The audit needs four things on disk that aren't in the repo today: the
`design-audit.mjs` script and the `design-review` agent/command assets copied out of
the ui-ux-pro-max plugin cache, a Playwright + Chromium install to drive the browser,
and the audit's own output. The plan left the commit posture open, flagging "adding
Playwright + Chromium to a lean Tauri repo" as a MEDIUM risk in its own risk table.

The tension is between reproducibility (a future re-run should not have to redo Phase
1's install-and-retarget from scratch) and keeping a deliberately lean dependency list
honest. FloatNotes ships 13 runtime and 8 dev dependencies; Playwright is heavyweight
and would be there for a one-off audit rather than for the product or its test suite,
which runs on vitest + jsdom.

## Decision

We will commit the audit tooling and its output on `chore/ui-ux-audit`:
`scripts/design-audit.mjs` (with the viewport ladder retargeted to FloatNotes reality),
the `.claude/` agent and command assets, the ADRs, and the consolidated report.

Playwright is **not** added to `package.json`. It is installed out-of-tree (npx or a
global install) and the exact command is documented alongside the script, so the audit
stays reproducible without the repo carrying the dependency.

## Consequences

- `bun install` in a fresh clone does not make `scripts/design-audit.mjs` runnable — the
  documented Playwright command must be run first. This is a deliberate trade and needs
  to be stated at the top of the script, or the next person hits a confusing failure.
- The repo's dependency list keeps meaning what it says: things the product and its test
  suite actually need.
- Re-running the audit later costs one install command, not a re-derivation of Phase 1.
- The script's retargeted viewport ladder is preserved in version control, so the
  FloatNotes-specific tiers (320/420/560/900) don't have to be rediscovered.
- Because Playwright is out-of-tree, the audit cannot be wired into CI as-is. That is
  consistent with the plan, which already defers CI wiring deliberately.
