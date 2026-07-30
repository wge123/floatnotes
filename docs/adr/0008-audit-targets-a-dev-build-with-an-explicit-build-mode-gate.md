# ADR 0008: The audit targets a dev build, behind an explicit build-mode gate

- Status: Accepted
- Date: 2026-07-30

## Context

`http://localhost:4949/` does not mean the same thing in every build.
`src-tauri/src/server.rs:113-124` picks the router's fallback handler at compile time:
a debug build proxies to the Vite dev server on 1420, a release build serves `dist/`
from disk via `serve_dist`. Both answer on 4949 and both render a working UI, so
nothing about the URL reveals which one is running.

This matters because a FloatNotes instance was already listening on 4949 when the audit
began, and it was the **installed release build**. Auditing it would have measured a
stale bundled `dist` rather than current `main`, silently. Two further consequences:
`/harness.html` — the plan's Phase 2 target for isolating the TipTap editor from app
chrome — exists only under `bun run dev` (`vite build` bundles `index.html` only), and
port binding is deliberately fail-loud with no fallback port (`server.rs:196-208`), so
starting a dev build while the release app holds 4949 errors out rather than taking over.

The plan's Phase 2 said only "run `bun run tauri dev`; confirm `localhost:4949` serves
the real UI." That check passes against a stale release build, which is exactly the
failure mode.

## Decision

The audit targets a **dev build** of current HEAD. Phase 2 gains an explicit preamble
before any measurement:

1. Quit the running FloatNotes instance and confirm 4949 is free.
2. Start `bun run tauri dev`.
3. Assert `http://localhost:4949/harness.html` resolves — this assertion **is** the
   `build-mode gate`. A release build 404s or falls back to `index.html`, so a
   resolving harness proves the debug-build proxy is live.

Only after the gate passes does any audit measurement run.

The rejected alternatives: auditing the release build is more faithful to shipped
reality but kills the harness pass and costs a slow `tauri build`; doing both adds a
build cycle and 20-30 minutes for a delta (bundling, minification, the `dist` fallback
path) that is unlikely to produce design findings.

## Consequences

- Findings describe current source, which is what an audit feeding a remediation pass
  should describe.
- The user's running FloatNotes panel is unavailable for the duration of the audit.
- Findings may not match the installed app if `dist` has drifted from `main`. Any
  finding whose fix already landed on `main` is still a valid finding about HEAD.
- Release-only surfaces go unaudited: `serve_dist`'s path handling and SPA fallback,
  and any minification-dependent rendering. Worth a line in the report's "not covered"
  section rather than silent omission.
- The gate is a cheap, deterministic assertion rather than a judgment call, so it can be
  written into the runsheet as a hard precondition a cold agent cannot skip.
