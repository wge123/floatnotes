# Stage 1 — Understanding brief: FloatNotes UI/UX audit

**Run:** `.apex/2026-07-30-ui-ux-audit/` · **Source plan:** `.plans/ui-ux-audit.md`
**Built:** 2026-07-30, from first principles against the repo at `chore/ui-ux-audit` (base `main` @ 6d6a875).

This brief is input to the grill, walkthrough, and sweep stages. Everything below marked
**VERIFIED** was read out of the source this session; everything marked **INFERRED** is
reasoning that a later stage should test rather than trust.

---

## 1. What is actually being audited

FloatNotes is a **single-screen app**. The entire UI surface is:

| Region | Component | Notes |
|---|---|---|
| Title bar (h-9) | `TitleBar.tsx` | note title, drag handle, click-to-copy-path |
| Error banner | inline in `App.tsx` | `bg-red-700` white text, only on load failure |
| Note body | `Editor.tsx` (TipTap) | fills remaining height, `outline: none` |
| Find bar | `FindBar.tsx` | inline strip above the bottom bar, ⌘F |
| Bottom bar | `FormatBar.tsx` + `StatusBar.tsx` | format toggles left, word/char count right |
| Switcher overlay | `NoteSwitcher.tsx` | ⌘P, `absolute inset-0`, scrim `bg-black/20` |
| Action overlay | `ActionPanel.tsx` | ⌘K, `absolute inset-0`, scrim `bg-black/10` |
| Toasts | inline in `App.tsx` | `fixed inset-x-0 bottom-10`, two variants |

**Scale (VERIFIED):** 8 components, ~4,400 LOC frontend including tests, **88 lines of CSS**,
one route, no dark mode, no responsive breakpoints, no design tokens file.

The load-bearing consequence: the audit stack being installed (a 7-phase model-judged design
review, a 6-tier viewport ladder, hallmark's 57 gates) is **built for a multi-page web product**.
Pointed at one 420×640 panel most of its machinery has nothing to bite on. The plan already
senses this (it retargets the viewport ladder), but under-corrects — see §5.

---

## 2. Spot-verification of the plan's four investigation findings

### Finding 1 — "4949 proxies to Vite, so plain Chromium renders the real UI" — **VERIFIED, with a gate the plan misses**

`src-tauri/src/server.rs:113-124` selects the fallback handler at **compile time**:

```rust
#[cfg(debug_assertions)]     fn add_frontend(r: Router) -> Router { r.fallback(proxy_to_vite) }
#[cfg(not(debug_assertions))] fn add_frontend(r: Router) -> Router { r.fallback(serve_dist) }
```

So `http://localhost:4949/` renders the real UI **only in a debug build**. A release build serves
`dist/` from disk (`serve_dist`, `server.rs:127`). Persistence is genuinely REST
(`src/lib/api.ts` → `/api/notes*`), so the browser really does load and save — that half of the
plan's claim is solid.

**The gate:** a FloatNotes instance is *already listening on 4949 right now* (PID 86929), and it is
the installed release build. Auditing it as-is audits a **stale bundled `dist`**, not current HEAD.
Two hard consequences:

- Port binding is deliberately fail-loud with no fallback (`server.rs:196-208`), so
  `bun run tauri dev` will **error out** rather than take over — the running app must be quit first.
- `/harness.html` **does not exist in a release build** (`dev-harness.tsx:16` — "`vite build` only
  bundles index.html"). Phase 2's second audit target only exists under `bun run tauri dev`.

→ *Phase 2 needs an explicit "quit the running app, start a dev build, confirm debug mode" preamble.*

### Finding 2 — "Tauri paths guarded by `__TAURI_INTERNALS__`" — **VERIFIED exactly**

All four cited sites are correct at the stated lines: `App.tsx:69`, `App.tsx:519`,
`TitleBar.tsx:10`, `app-keymap.ts:121`. The degradation is deliberate and commented
(`TitleBar.tsx:40-42`, `App.tsx:625` "Panel-only actions — meaningless in the plain browser
surface"). In browser mode the drag half of the title bar no-ops while **click-to-copy still
works**, and three ⌘K actions (screen share, login item, Esc behavior) are absent from the list
entirely. The plan's false-positive risk assessment is right, and its briefing mitigation is the
correct fix.

### Finding 3 — "420×640, transparent, undecorated, resizable" — **VERIFIED exactly**

`src-tauri/tauri.conf.json` confirms all four, plus `center: true`, `acceptFirstMouse: true`,
`macOSPrivateApi: true`, and `"csp": null`.

### Finding 4 — "transparency makes contrast a lead, not a verdict" — **VERIFIED but substantially overstated**

This is the one claim that materially changes on inspection. The app root is:

```tsx
<div className="relative flex h-screen flex-col overflow-hidden rounded-xl bg-white">
```

`bg-white` is **fully opaque** and fills the viewport. `App.css:20-23` sets `html, body` transparent
only so the container can draw its own rounded corners. The wallpaper therefore shows through
**at the four corner arcs and nowhere else** — and no text is rendered there.

Both overlay panels are likewise opaque (`bg-white` on `rounded-xl` cards).

→ **Contrast is a deterministic verdict across effectively the whole UI.** The plan's Phase 3
"re-run contrast against controlled light and dark backdrops" workaround is unnecessary
complexity solving a problem the app doesn't have. Dropping it removes a HIGH risk from the risk
table and shortens Phase 3.

*(The genuinely transparency-dependent surfaces are the two scrims — `bg-black/20` and
`bg-black/10` — which composite over opaque white here, so they too are checkable.)*

---

## 3. Findings already visible from source, before any tool runs

These are pre-loaded leads, not the audit's output. Each is cheap to confirm or kill, and each
raises the odds that the tool stack's value is confirmatory rather than generative.

| # | Lead | Evidence | Confidence |
|---|---|---|---|
| A | Default scaffold page title ships to users | `index.html:6` → `<title>Tauri + React + Typescript</title>` | **VERIFIED** |
| B | No visible focus indication anywhere | `App.css:38` `outline: none` on the editor; zero `focus-visible`/`focus:` classes in any component; buttons carry only `hover:` styles | **VERIFIED** (absence), impact INFERRED |
| C | Overlays are not dialogs | `NoteSwitcher`/`ActionPanel` are plain `div`s — no `role="dialog"`, no `aria-modal`, no focus trap, no focus restore on close | **VERIFIED** |
| D | Switcher modal is as wide as the window | `NoteSwitcher.tsx:86` `w-[420px]` inside a 420px window; guaranteed overflow at the plan's 320px tier | **VERIFIED** |
| E | `text-gray-400` on white ≈ 2.85:1 — fails WCAG AA | `NoteSwitcher.tsx:101,104,119`, `ActionPanel.tsx:69,83` (at `text-[10px]`), `FindBar.tsx:75` | **VERIFIED** (values), AA math INFERRED |
| F | ⌘P refetches every note's full content on every open | `NoteSwitcher.tsx:38-50` — `api.list()` then `Promise.all(metas.map(read))`, no cache, by design | **VERIFIED** |
| G | No empty or loading state for the note body | `App.tsx:709` renders `{note && <Editor/>}`; `note === null` yields a blank body, no spinner, no message | **VERIFIED** |
| H | Toast and undo-toast occupy identical coordinates | both `fixed inset-x-0 bottom-10` (`App.tsx:741`, `App.tsx:753`) — simultaneous display overlaps | **VERIFIED** (positions), collision INFERRED |
| I | `CLAUDE.md:14` port prose is wrong | `tauri.conf.json` `devUrl` is `http://127.0.0.1:1420`; 4949 is the axum proxy | **VERIFIED** — plan already caught this |

**Lead B is the most important one.** The plan nominates keyboard-only operation as a Phase 3
focus area; source-reading suggests it will fail hard, and it is the finding that no tool in the
chosen stack measures well (`design-audit.mjs` measures rendered geometry and color; hallmark
reads for generic-AI aesthetics; the model-judged review can see it but won't measure it).

---

## 4. The Phase 5b security question is already answered — without strix

Open decision #1 asks whether to add `usestrix/strix` for a security side-pass. That pass exists to
answer one question: *can a webpage reach `http://localhost:4949/notes`?* The source answers it:

- Every response carries `Access-Control-Allow-Origin: *` (`server.rs:96-111`), applied as
  middleware to **all** routes including `/api/notes` and `/api/notes/{id}`.
- Allowed methods include `PUT` and `DELETE` (`server.rs:104`).
- There is a **test locking this in** (`server.rs:453` `api_responses_carry_cors_headers_for_the_webview`).
- `"csp": null` in `tauri.conf.json`.

The code's own justification (`server.rs:83-86`) is: *"The server binds loopback only, so `*`
exposes nothing beyond what any local process can already reach."* **This reasoning does not hold
for the browser threat model.** A webpage is not "any local process": loopback-only binding stops
remote *network* peers, but `ACAO: *` is precisely the header that lets an arbitrary origin **read**
the response body. Any page the user visits could enumerate note titles via `GET /api/notes` and
read full contents via `GET /api/notes/{id}`.

**Mitigating factor (INFERRED, testable):** Chrome's Private Network Access gates public→loopback
subresource requests behind a preflight that expects `Access-Control-Allow-Private-Network: true`,
which this server never sends. So a modern Chrome tab on an `https://` page is likely blocked;
`http://` pages, `file://` pages, other browsers, and older Chrome are likely not.

**Consequence for decision #1:** strix would spend a large tool budget rediscovering a finding that
took ten minutes of reading. The residual uncertainty is purely empirical and is answered by a
~15-line Playwright probe (fetch `/api/notes` cross-origin from a data: or http: page, assert
whether the body is readable) — which the audit is already standing up Playwright for.

---

## 5. Integrated picture, and where the plan is mis-scaled

Putting §1–§4 together:

1. **The app is far smaller than the tooling assumes.** One screen, 88 lines of CSS, no theme
   system, no breakpoints. `design-audit.mjs` will produce a thin report and hallmark's
   anti-generic-AI-aesthetic gates have little surface — the app's visual language is already
   minimal and hand-tuned (see the deliberate list-rhythm CSS at `App.css:41-56`).
2. **The highest-value findings are accessibility and state coverage, not aesthetics** — leads B,
   C, D, G above. Precisely the areas the chosen stack covers *weakest*.
3. **Two of the plan's three HIGH risks are smaller than stated.** Contrast-under-transparency
   (§2.4) largely evaporates. The viewport-ladder noise risk is already mitigated by the plan's own
   Phase 1 retarget.
4. **One unstated risk is larger than any of them:** auditing the wrong build. Nothing in the plan
   distinguishes the running release binary from a dev build, and the difference decides whether
   the audit sees current source at all, and whether `/harness.html` exists.
5. **`docs/ux-testing.md` already exists and the plan never mentions it.** It defines an L1/L2/L3
   testing ladder explicitly targeting `:4949` with a manual sweep list including "open :4949 twice;
   edits in one appear in the other". The audit should extend that ladder, not silently build a
   parallel one — and its Level 3 list is the natural home for the plan's "not testable in browser"
   appendix.

## 6. Opinion

**The plan is structurally sound and should run, with five amendments.** Its evidentiary discipline
(source-tagging `measured` vs `model-judged`, model-judged findings never gating the verdict) is the
best thing in it and should survive untouched.

1. **Decision #1 → hallmark alone.** Not because security doesn't matter, but because the security
   question is already answered; convert Phase 5b from "run strix" to "empirically confirm the CORS
   read with a Playwright probe, report in a separated section." *(Confidence: high.)*
2. **Add a build-mode gate to Phase 2.** Quit the running instance, start `bun run tauri dev`,
   assert `/harness.html` resolves — that assertion *is* the debug-build proof. *(Confidence: high.)*
3. **Drop the controlled-backdrop contrast workaround from Phase 3;** treat contrast as
   deterministic. Keep one screenshot over a light and a dark wallpaper for the corner arcs only.
   *(Confidence: high — rests on `bg-white` being opaque, which is directly verified.)*
4. **Promote keyboard/focus/dialog-semantics to the audit's primary axis,** with the tool stack
   confirming rather than leading. Leads B, C, D, G are pre-loaded and cheap to verify.
   *(Confidence: medium-high — the absence of focus styling is verified; user impact is not yet.)*
5. **Fold the output into `docs/ux-testing.md`'s existing ladder** instead of inventing a parallel
   structure. *(Confidence: medium — depends on how the user wants that doc to evolve; a grill
   question.)*

**What would change my mind:** if `design-audit.mjs` turns out to measure focus-visibility and
dialog semantics directly, amendment 4 is redundant and the stack leads after all. If the running
4949 instance is actually a dev build (not the installed app), amendment 2 shrinks to a one-line
check. Both are settled in the first five minutes of Phase 1.

**On the pipeline itself:** this is a ~2.5h audit-only effort, below apex's intended tier. The two
human gates are still worth their cost here *only* because the plan ships with two genuinely open
decisions and, now, five proposed amendments — that is exactly what a grill is for. The
linearize + sweep stages are the questionable ones: a five-phase sequential audit with a
human-reviewed verdict at the end may be better served by running the phases directly than by
decomposing them into an autonomous todo chain. Worth deciding at the walkthrough, not now.
