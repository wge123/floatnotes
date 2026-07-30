# FloatNotes — UI/UX Audit + Design Review

**Type:** Audit-only plan (no remediation)
**Target repo:** `~/Developer/Personal/floatnotes`
**Created:** 2026-07-30
**Status:** Grilled 2026-07-30 (apex Stage 4) — all decisions settled, ADRs 0006-0011. Ready for walkthrough.
**Apex run:** `.apex/2026-07-30-ui-ux-audit/` · **Branch:** `chore/ui-ux-audit`

---

## Resolved decisions (apex grill, 2026-07-30 — ADRs 0006-0011)

All decisions are settled. Each links the ADR carrying its full rationale and consequences.

| # | Decision | ADR |
|---|---|---|
| 1 | **Primary axis is accessibility**, not the tool stack. Keyboard reachability, focus visibility, and dialog semantics lead; the stack confirms and backstops aesthetics. | [0006](../docs/adr/0006-ui-ux-audit-leads-with-accessibility-not-the-tool-stack.md) |
| 2 | **Tooling scope: hallmark alone.** No strix. Phase 5b becomes a targeted Playwright CORS probe — the underlying finding is already established from source. | [0007](../docs/adr/0007-security-side-pass-is-a-cors-probe-not-an-ai-pentester.md) |
| 3 | **Audit a dev build**, behind an explicit build-mode gate. Quit the running release instance first. | [0008](../docs/adr/0008-audit-targets-a-dev-build-with-an-explicit-build-mode-gate.md) |
| 4 | **Commit posture:** the script lives out-of-repo in `~/.local/share/floatnotes-audit/` with its own Playwright; the repo commits the report plus a non-runnable reference copy. `package.json` untouched. | [0012](../docs/adr/0012-audit-script-lives-outside-the-repo-only-output-is-committed.md) *(supersedes [0009](../docs/adr/0009-audit-tooling-is-committed-but-playwright-stays-out-of-package-json.md))* |
| 5 | **Output home:** standalone `audit-output/REPORT.md`; only the durable manual-verification checklist merges into `docs/ux-testing.md` Level 3. | [0010](../docs/adr/0010-audit-report-is-standalone-manual-steps-feed-back-into-ux-testing.md) |
| 6 | **Contrast is deterministic.** The app root is opaque `bg-white`; the wallpaper reaches only the corner arcs. Controlled-backdrop workaround dropped. | [0011](../docs/adr/0011-contrast-is-a-deterministic-verdict-despite-the-transparent-window.md) |

Branch is `chore/ui-ux-audit` (supersedes the plan-time `chore/ui-ux-audit-tooling`).

**▶ Execute from the runsheet, not from this document:
[`ui-ux-audit.runsheet.md`](./ui-ux-audit.runsheet.md)** — 14 numbered units with explicit
preconditions and acceptance checks, including two `agent-ready: no (physical)` steps this plan
never had (quit the running app; restore it afterwards). This document remains the rationale.

**Pre-loaded leads.** `.apex/2026-07-30-ui-ux-audit/01-understanding.md` §3 lists nine findings
already visible from source before any tool runs — a default scaffold `<title>`, absent focus
styling, non-dialog overlays, a 420px modal in a 420px window, sub-AA `text-gray-400`, an N+1
fetch on every ⌘P, no empty/loading state, colliding toast positions, and the `CLAUDE.md` port
nit. Each is cheap to confirm or kill; they are inputs to the audit, not its output.

---

## Objective

Run a UI/UX quality audit and design review on FloatNotes using the ui-ux-pro-max plugin's
audit stack plus `Nutlope/hallmark`, producing ranked, evidence-backed findings and a
ship/no-ship verdict. **Apply no fixes** — remediation is a separate, separately-approved pass.

---

## Investigation findings (established 2026-07-30 — a fresh agent should trust these but spot-verify)

Four facts materially shape the approach:

1. **FloatNotes is browser-auditable.** `vite.config.ts` documents that the in-app **axum server
   owns port 4949 and proxies to Vite (1420)**, so `http://localhost:4949/` always renders the
   real UI. Persistence runs over a **REST surface** (`src/lib/api.ts` → `src-tauri/src/server.rs`),
   *not* Tauri IPC — so in plain Chromium the app genuinely loads and saves notes. Playwright
   drives the real application, not a mock.

2. **Tauri-only paths are already guarded.** `"__TAURI_INTERNALS__" in window` gates behavior at
   `src/components/TitleBar.tsx:10`, `src/App.tsx:69`, `src/App.tsx:519`, and
   `src/lib/app-keymap.ts:121`. Browser mode degrades by design — but **title-bar drag, the global
   ⌥N shortcut, and window operations will be inert**. An unbriefed reviewer will report these as
   defects. This is the single largest false-positive risk in the whole plan.

3. **The window is 420×640, `transparent: true`, `decorations: false`** (`src-tauri/tauri.conf.json`),
   with `resizable: true`. The audit script's stock viewport ladder (360/390/768/1024/1440/1920) is
   largely meaningless — there is no 1920 desktop layout to check.

4. **Transparency breaks the contrast checker.** `design-audit.mjs` approximates contrast against
   the "nearest opaque background." With a transparent window the true backdrop is the user's
   wallpaper — unknowable at audit time. Contrast output is a **lead, not a verdict**, unless
   tested against controlled backdrops.

**Nothing is installed.** `design-audit.mjs`, the `design-review` agent, and the `/design-review`
command all sit unused in the plugin cache at:
`~/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.11.0/stack/`

---

## Tool selection rationale

Only one repo from the candidate shortlist earns its place. Recorded so a fresh agent does not
re-litigate the choice:

| Repo | Verdict |
|---|---|
| **Nutlope/hallmark** | ✅ **Use.** Static anti-slop design audit. `hallmark audit <target>` scores code against generic-AI-aesthetic anti-patterns — punch list, no edits. Install: `npx skills add nutlope/hallmark`. Complements the browser pass: taste-in-source vs behavior-rendered. |
| polygraphso/litmus | ❌ Grades MCP servers on behavioral security. Nothing to do with a notes UI. |
| usestrix/strix | ⚠️ AI pentester. Out of scope for a *design* review — but see optional Phase 5b. |
| browser-use/browser-use | ❌ Redundant. Playwright MCP already drives the browser, deterministically. |
| alibaba/page-agent | ❌ In-page GUI copilot for SaaS. Automation, not verification — no assertions. |
| stablyai/orca | ❌ Installing a parallel-agent desktop ADE to review one 420px panel is over-tooling. |

**Evidentiary discipline (non-negotiable):** `design-audit.mjs` is *deterministic* — real measured
values, `exit 2` on high-severity. `hallmark` and `/design-review` are *model-judged* — persuasive
but not reproducible. **Every finding in the final report must be tagged by source
(`measured` / `model-judged`)** so the reader knows what is fact and what is opinion. Model-judged
findings never gate the verdict on their own.

---

## Phases

### Phase 1 — Install & wire (no application changes)

- Copy from the plugin cache into the repo:
  - `stack/scripts/design-audit.mjs` → `scripts/design-audit.mjs`
  - `stack/.claude/agents/design-review.md` → `.claude/agents/design-review.md`
  - `stack/.claude/commands/design-review.md` → `.claude/commands/design-review.md`
  - `stack/.claude/commands/design-plan.md` → `.claude/commands/design-plan.md`
- Install Playwright + Chromium **out-of-tree** — NOT as a devDependency (ADR 0009). Document
  the exact install command in a header comment at the top of `scripts/design-audit.mjs`, so a
  fresh clone fails loudly with instructions rather than confusingly.
- **Retarget the viewport ladder** in `design-audit.mjs` to FloatNotes reality before any run:
  - `320×480` (minimum sane)
  - `420×640` (shipped default)
  - `560×800`
  - `900×1000` (maximum sane resize)
  - Delete the 1440 and 1920 tiers.
- **Do not** add `.github/workflows/design-review.yml` yet — see Risks.

**Exit criteria:** script present, Chromium installed, tiers retargeted, `bun run build` still green.

### Phase 2 — Deterministic pass

**Build-mode gate (ADR 0008) — hard precondition, nothing measures until it passes:**

1. Quit the running FloatNotes instance; confirm 4949 is free (`lsof -nP -iTCP:4949 -sTCP:LISTEN`).
   Binding is fail-loud with no fallback port — a dev build will error, not take over.
2. `bun run tauri dev`.
3. Assert `http://localhost:4949/harness.html` **resolves**. This is the gate: the 4949→Vite
   proxy is `#[cfg(debug_assertions)]` only, and `vite build` bundles `index.html` alone, so a
   resolving harness proves a debug build. A release build would serve a stale `dist/` and pass
   a naive "does the UI render" check.

Then:

- Confirm `http://localhost:4949/` serves the real UI **with notes loading** (proves the REST
  path, not just a render).
- `node scripts/design-audit.mjs --url http://localhost:4949 --out audit-output`
- Second run against `http://localhost:4949/harness.html` to isolate the TipTap editor from app chrome.
- Preserve `report.json`, `report.md`, and all screenshots. **Record the process exit code** — that
  is the objective gate (`2` = high-severity findings exist).

**Exit criteria:** two `report.json` files + screenshot sets on disk; exit codes recorded.

### Phase 3 — Model-judged browser review

Run `/design-review http://localhost:4949` with an explicit **browser-mode briefing** so guarded
Tauri paths are not reported as defects.

Two substitutions to the stock 7-phase review:
- **Responsiveness** re-scoped to the 320→900 resize range, not the web tier ladder.
- **Contrast** taken at face value as a `measured` verdict (ADR 0011) — the app root is opaque
  `bg-white`, so the wallpaper reaches only the corner arcs. Capture one light-wallpaper and one
  dark-wallpaper screenshot scoped to those arcs; no controlled-backdrop re-run.

**Primary axis (ADR 0006) — lead here, and let the tools confirm:**
- **Keyboard reachability** — tab order, visible focus, no traps, focus restored on overlay close.
  Note `App.css:38` sets `outline: none` on the editor and no component defines any `focus-visible`
  style; treat "focus is invisible everywhere" as a hypothesis to confirm or kill first.
- **Dialog semantics** — `NoteSwitcher` and `ActionPanel` are plain `div`s: no `role="dialog"`,
  no `aria-modal`, no focus trap. Verify against a screen reader's actual behavior, not just the DOM.

Then the remaining focus areas:
- **The overlay stack** — `FindBar`, `NoteSwitcher`, `ActionPanel` interaction and escape behavior.
- **Empty / loading / error states** — `App.tsx` renders `{note && <Editor/>}`, so a null note
  yields a blank body with no indicator; also the real `ConflictError` path in `src/lib/api.ts`
  (stale-mtime conflict; disk wins).
- **Long-string robustness** in note titles and the switcher list.

**Exit criteria:** ranked findings with screenshot/console evidence per item.

### Phase 4 — Static taste pass

- `npx skills add nutlope/hallmark`
- `hallmark audit src/` across the 8 components plus `src/App.css`.
- Cross-reference against Phases 2 and 3:
  - All three agree → **high confidence**.
  - hallmark alone objects → **taste**; flag as such, do not escalate.

**Exit criteria:** punch list produced and cross-referenced; no edits applied.

### Phase 5 — Consolidate

Produce `audit-output/REPORT.md` containing:
- **Verdict:** Ship / Ship with fixes / Needs work
- Findings ranked **Blockers → High → Medium → Nits**, each carrying:
  - source tag (`measured` / `model-judged`)
  - evidence (screenshot path, console line, or measured value)
- **Appendix: "Not testable in browser"** — the Tauri-only surface requiring manual verification in
  the real window (title-bar drag, global ⌥N, window ops, true transparency over wallpaper).
  **This appendix also merges into `docs/ux-testing.md` Level 3** (ADR 0010) — it is the durable
  half of the output. Split rule: *what we found* stays in the report; *what someone must check by
  hand, forever* goes to `ux-testing.md`.
- **Appendix: "Not covered"** — release-only surfaces (`serve_dist` path handling, SPA fallback,
  minification-dependent rendering) skipped by the dev-build choice (ADR 0008), plus the security
  surfaces skipped by dropping strix (ADR 0007).
- **Doc nit to record:** `CLAUDE.md` states "Dev server port: 4949 (`vite.config.ts` +
  `tauri.conf.json` devUrl — keep in sync)", but Vite is on 1420 and 4949 is the axum proxy. Stale
  prose, not a bug.

**Exit criteria:** single consolidated report; **zero source files modified** outside Phase 1 tooling.

### Phase 5b — Security side-pass: targeted CORS probe *(ADR 0007 — no strix)*

The finding is already **established from source**, not open: `server.rs:96-111` applies
`Access-Control-Allow-Origin: *` to every route including `/api/notes` and `/api/notes/{id}`,
with `PUT`/`DELETE` allowed and a test locking the behavior in; `tauri.conf.json` sets
`"csp": null`. The code's justification — loopback-only binding means `*` "exposes nothing
beyond what any local process can already reach" — does not hold for browsers: a webpage is not
a local process, and `ACAO: *` is exactly what permits an arbitrary origin to **read** the body.

The one open question is empirical: does Chrome's Private Network Access gate block it in
practice, given the server never sends `Access-Control-Allow-Private-Network: true`?

- Write a ~15-line Playwright probe: from an `http://` origin and an `https://` origin,
  cross-origin `fetch('http://127.0.0.1:4949/api/notes')` and assert whether the body is readable.
- Report in a clearly separated security section so it never dilutes the design verdict.
- **Not covered** (would have needed strix, deliberately out of scope): the WebSocket surface,
  `serve_dist` path handling, the sidecar write endpoint. File as a separate security effort.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Auditing the wrong build** — 4949 answers identically for debug and release | **HIGH** | Build-mode gate in Phase 2 (ADR 0008); `/harness.html` must resolve before anything measures |
| Guarded Tauri paths reported as defects | **HIGH** | Explicit browser-mode briefing in Phase 3; dedicated "not testable" appendix |
| Stock viewport ladder produces noise findings | **MEDIUM** | Retarget tiers in Phase 1 *before* any run |
| CI gate would fail-on-high against a floating window it cannot model | **MEDIUM** | Deferred deliberately; revisit only after real signal exists |
| Verdict rests partly on judgment the stack can't reproduce (a11y-led axis) | **MEDIUM** | `measured`/`model-judged` tagging makes the split visible per finding (ADR 0006) |
| hallmark's "57 gates" are model-judged, not deterministic | **LOW** | Labeled as taste throughout; never gates the verdict |
| Contrast findings unreliable under `transparent: true` | ~~HIGH~~ → **LOW** | Downgraded (ADR 0011): app root is opaque `bg-white`; rescoped to the corner arcs only |
| Adding Playwright + Chromium to a lean Tauri repo | ~~MEDIUM~~ → **LOW** | Resolved (ADR 0009): installed out-of-tree, never enters `package.json` |
| Repo is on `main` | **RESOLVED** | Branch `chore/ui-ux-audit` cut at apex Stage 0 |

---

## Scope boundaries

**In scope:** tool install, deterministic audit, model-judged review, static taste pass,
consolidated report.

**Out of scope:** applying fixes, CI wiring, Tauri-native window testing, any redesign work.

---

## Complexity: MEDIUM

| Phase | Estimate |
|---|---|
| 1 — Install & wire | ~30 min |
| 2 — Deterministic pass | ~20 min |
| 3 — Browser review | ~45 min |
| 4 — Static taste pass | ~20 min |
| 5 — Consolidate | ~25 min |
| **Total** | **≈ 2–2.5 hours** |

---

## Reference

- Plugin stack source: `~/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.11.0/stack/`
- Example audit output shape: `.../stack/examples/juniper-audit/` (`report.json`, `report.md`, screenshots)
- hallmark: https://github.com/Nutlope/hallmark — `npx skills add nutlope/hallmark`
- Repo conventions: `CLAUDE.md`; design decisions: `docs/adr/`
