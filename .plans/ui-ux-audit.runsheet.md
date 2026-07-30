# Runsheet: ui-ux-audit

- **Source plan(s)**: `.plans/ui-ux-audit.md`
- **Date**: 2026-07-30
- **Git rev**: `60da055` (chore/ui-ux-audit)
- **Decisions**: ADRs 0006-0012 · **Understanding**: `.apex/2026-07-30-ui-ux-audit/01-understanding.md`
- **Execution mode**: direct sequential execution — no todo chain, no autonomous sweep (D2)

## Units

### S01 — Stand up the out-of-repo audit rig
- **files**: `~/.local/share/floatnotes-audit/{package.json,design-audit.mjs}`
- **pre**: on `chore/ui-ux-audit`; network available
- **do**: `mkdir -p ~/.local/share/floatnotes-audit && cd ~/.local/share/floatnotes-audit && npm init -y && npm i playwright && npx playwright install chromium`; then copy `~/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.11.0/stack/scripts/design-audit.mjs` into that directory
- **accept**: `node -e "import('playwright').then(()=>console.log('ok'))"` run from `~/.local/share/floatnotes-audit/` prints `ok`
- **depends**: [none]   **parallel-group**: A   **size**: S
- **agent-ready**: yes

### S02 — Retarget the viewport ladder to FloatNotes reality
- **files**: `~/.local/share/floatnotes-audit/design-audit.mjs`
- **pre**: S01
- **do**: replace the `VIEWPORTS` array (lines 25-32) with exactly four tiers — `min-320` 320×480, `default-420` 420×640, `mid-560` 560×800, `max-900` 900×1000. Delete the 360/390/768/1024/1440/1920 entries.
- **accept**: `grep -c "name: '" design-audit.mjs` returns `4`; `grep -E "1440|1920|768|1024" design-audit.mjs` returns nothing
- **depends**: [S01]   **parallel-group**: A   **size**: S
- **agent-ready**: yes

### S03 — Copy the design-review agent and commands into the repo
- **files**: `.claude/agents/design-review.md`, `.claude/commands/design-review.md`, `.claude/commands/design-plan.md`
- **pre**: on `chore/ui-ux-audit`
- **do**: copy the three files from `~/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.11.0/stack/.claude/` preserving relative paths. Do **not** copy `.github/workflows/design-review.yml` — CI is deliberately deferred.
- **accept**: all three paths exist; `ls .github/workflows/design-review.yml` fails
- **depends**: [none]   **parallel-group**: A   **size**: S
- **agent-ready**: yes

### S04 — Pass the build-mode gate
- **files**: none (runtime state)
- **pre**: S01-S03; the installed FloatNotes app is running and holding port 4949
- **do**: quit the running FloatNotes instance; confirm the port is free with `lsof -nP -iTCP:4949 -sTCP:LISTEN` (expect no output); start `bun run tauri dev` in the background; wait for `[floatnotes] serving on http://127.0.0.1:4949` on stdout
- **accept**: `curl -s http://localhost:4949/harness.html | grep -q 'dev-harness.tsx'`. **A status-code check is NOT sufficient** — `serve_dist` (`server.rs:143`) falls back to `index.html` for unknown routes, so a release build returns `200` for `/harness.html` too. Only the body distinguishes them: the harness references `/src/dev-harness.tsx`, `index.html` references `/src/main.tsx`. Corroborate with `lsof -nP -iTCP:1420 -sTCP:LISTEN` (Vite must be listening) and the `@vite/client` script tag in the response. **Nothing downstream runs until the body check passes.**
- **depends**: [S01, S02, S03]   **parallel-group**: serial   **size**: S
- **agent-ready**: no — physical (quitting the user's running app is a real-world action on their machine; ADR 0008)

### S05 — Confirm the REST path, not just a render
- **files**: none
- **pre**: S04
- **do**: `curl -s http://localhost:4949/api/notes | head -c 400`; then load `http://localhost:4949/` in a browser and confirm a note's content renders in the editor
- **accept**: the curl returns a JSON array of note metadata (non-empty, each with `id`/`title`/`mtime`), and the browser shows that note's text
- **depends**: [S04]   **parallel-group**: serial   **size**: S
- **agent-ready**: yes

### S06 — Deterministic pass against the app
- **files**: `audit-output/app/report.json`, `audit-output/app/report.md`, `audit-output/app/screenshots/*.png`
- **pre**: S05
- **do**: from `~/.local/share/floatnotes-audit/`, run `node design-audit.mjs --url http://localhost:4949 --out <repo>/audit-output/app`; capture the exit code with `echo $?`
- **accept**: `report.json`, `report.md`, and 4 screenshots exist; the exit code is recorded verbatim in the run notes (`2` = high-severity findings, `0` = none). Do not treat exit `0` as "contrast is fine" — contrast is emitted at medium and never gates the exit code (ADR 0006 correction).
- **depends**: [S05]   **parallel-group**: serial   **size**: S
- **agent-ready**: yes

### S07 — Deterministic pass against the editor harness
- **files**: `audit-output/harness/report.json`, `audit-output/harness/report.md`, `audit-output/harness/screenshots/*.png`
- **pre**: S06
- **do**: `node design-audit.mjs --url http://localhost:4949/harness.html --out <repo>/audit-output/harness`; capture the exit code
- **accept**: both reports and 4 screenshots exist; exit code recorded. Purpose is isolating TipTap from app chrome — findings present here but absent in S06 are editor-owned.
- **depends**: [S06]   **parallel-group**: serial   **size**: S
- **agent-ready**: yes

### S08 — Accessibility pass: the axis the tools do not cover
- **files**: `audit-output/a11y-findings.md`
- **pre**: S05
- **do**: drive `http://localhost:4949` and verify each of the four surfaces `design-audit.mjs` cannot see. (1) Tab order: tab from a cold load through every control, recording the visited sequence. (2) Focus traps: open ⌘P then ⌘K; tab repeatedly; record whether focus escapes the overlay to the editor beneath. (3) Focus restoration: open each overlay, press Esc, record where focus lands. (4) Dialog semantics: check `NoteSwitcher` and `ActionPanel` root nodes for `role="dialog"` / `aria-modal`. Record each with a screenshot or the DOM snippet as evidence, tagged `measured` or `model-judged` per ADR 0006.
- **accept**: `a11y-findings.md` has one entry per surface, each carrying a verdict, its evidence, and a source tag
- **depends**: [S05]   **parallel-group**: serial   **size**: M
- **agent-ready**: yes

### S09 — Model-judged browser review
- **files**: `audit-output/design-review.md`
- **pre**: S06, S07, S08
- **do**: run `/design-review http://localhost:4949` with a briefing that states: browser mode is a deliberately degraded surface — title-bar drag, global ⌥N, and the three panel-only ⌘K actions (screen share, login item, Esc behavior) are inert **by design** (guards at `App.tsx:69`, `App.tsx:519`, `TitleBar.tsx:10`, `app-keymap.ts:121`) and must not be reported as defects; responsiveness is scoped to the 320→900 range; "No `<h1>`" is a known false positive because the note body is user content. Focus areas: the overlay stack (`FindBar`/`NoteSwitcher`/`ActionPanel`), empty/loading/error states including `ConflictError`, and long-string robustness in titles and the switcher list.
- **accept**: ranked findings, each with screenshot or console evidence, and zero findings about the four guarded Tauri surfaces
- **depends**: [S06, S07, S08]   **parallel-group**: serial   **size**: M
- **agent-ready**: yes

### S10 — Static taste pass
- **files**: `audit-output/hallmark.md`
- **pre**: S03
- **do**: `npx skills add nutlope/hallmark`, then `hallmark audit src/` covering the 8 components plus `src/App.css`
- **accept**: punch list on disk, every item tagged `model-judged`. Cross-reference against S06/S07 and S09: agreement across all three = high confidence; hallmark-only objections are labelled taste and never escalate.
- **depends**: [S03]   **parallel-group**: B   **size**: S
- **agent-ready**: yes — ⚠️ the install command and `hallmark audit` CLI surface are unverified (network-dependent, taken from the plan's Reference section). If either differs, record the actual command used.

### S11 — CORS probe (security side-pass)
- **files**: `audit-output/security-cors.md`
- **pre**: S05
- **do**: write a ~15-line Playwright script in `~/.local/share/floatnotes-audit/` that, from an `http://` origin and again from an `https://` origin, issues `fetch('http://127.0.0.1:4949/api/notes')` and attempts to read the body. Record for each origin: did the request complete, was the body readable, and did Chrome emit a Private Network Access console warning.
- **accept**: a table of origin × (completed / body-readable / PNA warning), plus the resulting severity. Reported in its own section so it never dilutes the design verdict.
- **depends**: [S05]   **parallel-group**: B   **size**: S
- **agent-ready**: yes

### S12 — Consolidate into the report
- **files**: `audit-output/REPORT.md`, `audit-output/design-audit.reference.mjs`
- **pre**: S06, S07, S08, S09, S10, S11
- **do**: write `REPORT.md` with the verdict (Ship / Ship with fixes / Needs work), findings ranked Blockers → High → Medium → Nits — each carrying a `measured`/`model-judged` tag and its evidence path — plus the "Not testable in browser" appendix (title-bar drag, global ⌥N, window ops, true transparency over wallpaper), the "Not covered" appendix (release-only surfaces per ADR 0008; WebSocket/`serve_dist`/sidecar-write per ADR 0007), the security section from S11, and the `CLAUDE.md:14` port doc nit. Copy the retargeted script to `audit-output/design-audit.reference.mjs` with a header stating it is a reference copy, not runnable in place, and naming the `~/.local/share/floatnotes-audit/` setup.
- **accept**: `REPORT.md` exists with a verdict line and zero untagged findings; `git status` shows **no modifications** under `src/` or `src-tauri/`
- **depends**: [S06, S07, S08, S09, S10, S11]   **parallel-group**: serial   **size**: M
- **agent-ready**: yes

### S13 — Feed the durable half back into ux-testing.md
- **files**: `docs/ux-testing.md`
- **pre**: S12
- **do**: merge the "Not testable in browser" checklist into the Level 3 section. Split rule (ADR 0010): *what we found* stays in `REPORT.md`; *what someone must check by hand, forever* moves here. Do not copy the verdict or the ranked findings.
- **accept**: `docs/ux-testing.md` L3 lists the manual surfaces; `REPORT.md` still holds the findings; neither duplicates the other
- **depends**: [S12]   **parallel-group**: serial   **size**: S
- **agent-ready**: yes

### S14 — Restore the user's environment
- **files**: none (runtime state)
- **pre**: S12
- **do**: stop `bun run tauri dev`; relaunch the installed FloatNotes app
- **accept**: the FloatNotes panel is running again and ⌥N summons it
- **depends**: [S12]   **parallel-group**: serial   **size**: S
- **agent-ready**: no — physical (relaunching the user's app on their desktop; pairs with S04)

## Decisions needed

| ID | Decision | Blocks | Status |
|----|----------|--------|--------|
| D1 | How does `design-audit.mjs` resolve its bare `playwright` import? | S01, S02, S06, S07 | decided: script lives out-of-repo in `~/.local/share/floatnotes-audit/` with its own deps; repo gets output + a non-runnable reference copy — supersedes ADR 0009 via ADR 0012 |
| D2 | Decompose into a todo chain + autonomous sweep, or execute directly? | all | decided: execute directly — the audit is strictly sequential with zero parallelism and ends in a human-read verdict, so decomposition is pure overhead |
| D3 | Are `npx skills add nutlope/hallmark` and `hallmark audit <path>` the real CLI surface? | S10 | deferred: unblock by running the install in S10 and recording what the tool actually exposes — network-dependent, not checkable offline |

## Walkthrough log

| file:line | what | resolution |
|-----------|------|------------|
| `.plans/ui-ux-audit.md:97` | Phase 1 said add Playwright as a bun devDependency; ADR 0009 changed that to out-of-tree, but `design-audit.mjs:20` imports `playwright` as a bare specifier so neither works as written | corrected: D1 — script moves out of the repo entirely (ADR 0012 supersedes ADR 0009) |
| `.apex/…/01-understanding.md` §5.2 | Brief claimed the tool stack measures focus visibility weakest; `design-audit.mjs:93` checks `focus-visible` at high severity, plus `accessible-name` (:102) and `tap-target` (:79) | corrected: folded into ADR 0006 Consequences — the axis decision stands on the narrower basis of dialog semantics, focus traps, focus restore, and tab order, which the script genuinely does not measure |
| `design-audit.mjs:131` | Contrast is emitted at **medium**, so it never triggers the `exit 2` gate — the objective gate under-reports exactly the class ADR 0011 made deterministic | corrected: S06 acceptance forbids reading the exit code as a contrast verdict; noted in ADR 0006 |
| `design-audit.mjs:106` | The `headings` check fires "No `<h1>` on the page" at medium; the note body is user content, so this is a guaranteed false positive | corrected: pre-briefed in S09; to be listed as a known false positive in the report |
| `.plans/ui-ux-audit.md:117` | Phase 2's "confirm the UI serves" check passes against a stale release build — 4949 answers identically for debug and release | corrected at grill: build-mode gate is now S04, a hard precondition (ADR 0008) |
| `.plans/ui-ux-audit.md:97` | Plan listed no step to quit the running app or restore it afterwards, though both are required and neither is agent-doable | corrected: added as S04 and S14, both `agent-ready: no (physical)` |
| `.plans/ui-ux-audit.md:198` | Phase 5b was conditional on a decision that is now settled | corrected at grill: unconditional CORS probe, no strix (ADR 0007) |
| `.plans/ui-ux-audit.md:211` | `npx skills add nutlope/hallmark` and `hallmark audit src/` are unverifiable offline | deferred: D3 — record the actual CLI surface during S10 |
| apex Stages 6-7 | Runsheet was to be decomposed into a todo chain and swept autonomously | decided: D2 — skipped; sequential workload with no parallelism and a human gate at the end |
