# FloatNotes — UI/UX Audit + Design Review

**Type:** Audit-only plan (no remediation)
**Target repo:** `~/Developer/Personal/floatnotes`
**Created:** 2026-07-30
**Status:** Approved for execution via `/apex`

---

## Open decisions — resolve before Phase 1

These were raised at plan time and are **not yet answered**. Apex must surface them at its
grill stage rather than silently picking a default.

1. **Tooling scope:** `hallmark` alone, or add `strix` for the optional security side-pass
   (Phase 5b)? Default if unanswered: **hallmark alone**.
2. **Commit posture:** commit the tooling (`scripts/`, `.claude/`, `package.json`) to a branch,
   or keep it uncommitted/scratch for this one-off? Default if unanswered: **branch**
   (`chore/ui-ux-audit-tooling`), since the repo is currently on `main` and the branching
   doctrine forbids authoring commits there.

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
- Add `playwright` as a **devDependency** via bun (never npm/yarn/pnpm — repo convention), then
  install Chromium.
- **Retarget the viewport ladder** in `design-audit.mjs` to FloatNotes reality before any run:
  - `320×480` (minimum sane)
  - `420×640` (shipped default)
  - `560×800`
  - `900×1000` (maximum sane resize)
  - Delete the 1440 and 1920 tiers.
- **Do not** add `.github/workflows/design-review.yml` yet — see Risks.

**Exit criteria:** script present, Chromium installed, tiers retargeted, `bun run build` still green.

### Phase 2 — Deterministic pass

- `bun run tauri dev`; confirm `http://localhost:4949/` serves the real UI **with notes loading**
  (proves the REST path, not just a render).
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
- **Contrast** re-run against **controlled light and dark backdrops** to work around `transparent: true`.

Focus areas that actually matter for this app:
- **Keyboard-only operation** — it is a keyboard-driven app. Tab order, visible focus, no traps.
- **The overlay stack** — `FindBar`, `NoteSwitcher`, `ActionPanel` interaction and escape behavior.
- **Empty / loading / error states** — including the real `ConflictError` path in `src/lib/api.ts`
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
- **Doc nit to record:** `CLAUDE.md` states "Dev server port: 4949 (`vite.config.ts` +
  `tauri.conf.json` devUrl — keep in sync)", but Vite is on 1420 and 4949 is the axum proxy. Stale
  prose, not a bug.

**Exit criteria:** single consolidated report; **zero source files modified** outside Phase 1 tooling.

### Phase 5b — Security side-pass *(OPTIONAL — only if decision #1 selects strix)*

`src-tauri` runs an **axum HTTP server on localhost:4949 serving all notes**, with `"csp": null` in
`tauri.conf.json`. Open question: can any webpage in the user's browser reach
`http://localhost:4949/notes` via permissive CORS?

Legitimate question, but a **security** finding rather than a design one — keep it opt-in, run it
last, and report it in a clearly separated section so it never dilutes the design verdict.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Guarded Tauri paths reported as defects | **HIGH** | Explicit browser-mode briefing in Phase 3; dedicated "not testable" appendix |
| Contrast findings unreliable under `transparent: true` | **HIGH** | Controlled light/dark backdrops; label all contrast output as leads |
| Stock viewport ladder produces noise findings | **MEDIUM** | Retarget tiers in Phase 1 *before* any run |
| Adding Playwright + Chromium to a lean Tauri repo | **MEDIUM** | devDependency only; confirm before committing `package.json` |
| CI gate would fail-on-high against a floating window it cannot model | **MEDIUM** | Deferred deliberately; revisit only after real signal exists |
| hallmark's "57 gates" are model-judged, not deterministic | **LOW** | Labeled as taste throughout; never gates the verdict |
| Repo is on `main` | **LOW** | Branch before any commit (`chore/ui-ux-audit-tooling`); never author commits on `main` |

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
