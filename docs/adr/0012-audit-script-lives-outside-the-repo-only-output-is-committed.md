# ADR 0012: The audit script lives outside the repo; only its output and a reference copy are committed

- Status: Accepted
- Date: 2026-07-30

## Context

Supersedes ADR 0009, which decided to commit `scripts/design-audit.mjs` while keeping
Playwright out of `package.json`. The walkthrough found that combination does not work.

`design-audit.mjs:20` imports its dependency as a bare specifier:

```js
import { chromium } from 'playwright';
```

Node resolves a bare specifier by walking `node_modules` up the directory tree from the
importing file. A globally installed Playwright is not on that path. So a committed
`scripts/design-audit.mjs` with no `package.json` entry fails at **import** time with
`ERR_MODULE_NOT_FOUND` — before it ever tries to launch a browser. ADR 0009's premise,
that documenting an install command was sufficient, was wrong: the problem is module
resolution, not browser discovery.

The three ways out were: run through `npx -p playwright` so the module is on the path for
one command; move the script out of the repo into a directory that owns its own
dependencies; or reverse ADR 0009 and take the devDependency.

## Decision

The audit script lives **outside the repo**, in `~/.local/share/floatnotes-audit/`, with
its own `package.json` and its own Playwright install. That directory is the only place
the script is runnable, and it is durable across sessions (not the ephemeral session
scratchpad), so a re-run costs nothing.

The repo commits:
- `audit-output/REPORT.md` and the screenshots — the actual deliverable;
- `audit-output/design-audit.reference.mjs` — a copy of the retargeted script, carrying a
  header comment stating that it is a **reference copy, not runnable in place**, naming
  `~/.local/share/floatnotes-audit/` and the setup commands.

`package.json` is untouched, which was ADR 0009's core intent and survives this revision.

## Consequences

- The committed script copy is deliberately non-runnable in place. This is the honest cost
  of the choice and must be stated in its header, or the next reader wastes time on a
  confusing `ERR_MODULE_NOT_FOUND`.
- The FloatNotes-specific viewport retargeting (320/420/560/900) is still preserved in
  version control via the reference copy, so it never has to be rediscovered.
- The real dependency lives on one machine. A different machine re-runs the
  `~/.local/share/floatnotes-audit/` setup — two commands — rather than inheriting it from
  the clone.
- `bun install` in a fresh clone stays exactly as lean as it is today, and the repo's
  dependency list keeps meaning "what the product and its vitest suite need."
- CI wiring remains impossible without revisiting this, consistent with the plan's
  deliberate deferral of the CI gate.
