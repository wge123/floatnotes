# Agentic UX Testing

Why this exists: the `- [ ]` todo bug shipped because nothing exercised real
typing — unit tests passed while the UX was broken. This plan makes the UX
itself testable, mostly by agents.

## The trick that makes it agentic

FloatNotes serves the **identical React app** over `http://localhost:4949`
(axum, same bundle the panel renders). Playwright drives that surface with
real keystrokes, real clicks, the real server, and real `~/Notes` files —
no mocks. Everything except the native shell is agent-testable while the
app is simply running.

Two layers stay native-only (human or scripted-AppleScript):
hotkey (⌥N), panel drag, Spaces/fullscreen join, screen-share hiding,
login item, menubar. Everything else: browser.

## Layers

| Layer | What | Runner | When |
|---|---|---|---|
| L1 | lib logic (markdown, keymap, ws, format, input rules) | `bunx vitest run` | every change |
| L2 | UX flows in the real app | agent + `playwright-cli` against :4949 | after any UI change; full sweep before release |
| L3 | native shell checklist | human (~2 min) | before release |

## L2 flow catalog

Each flow is independent; an agent runs them in any order against a THROWAWAY
notes dir when destructive (set `FLOATNOTES_DIR`, restart app) — or accepts
mutating the live inbox for read-mostly checks.

1. **Boot + deeplink** — `/` opens most-recent; `/?note=<id>` opens that note;
   dead id toasts "note not found" and falls back.
2. **Type + autosave + disk** — type text, wait 600ms, `cat` the `.md` file:
   content present, title = first line. External edit to the file (clean note)
   silently reloads; external edit while dirty resolves via 409 → "reloaded".
3. **Todos (regression: this doc's origin)** — type `- [ ] x` → checkbox
   appears; type `[x] y` on a fresh line → checked item; click checkbox →
   toggles + persists to disk as `- [x]`; reload → still a checkbox, never
   literal `\[ \]`.
4. **Format toolbar** — every button toggles its mark/block and lights active
   state; H popover sets levels; link button prompts, sets, and unlinks;
   serialization round-trips through disk.
5. **Title bar** — shows note title; updates when first line changes; is not
   editable (typing does nothing).
6. **Overlays + Esc layering** — ⌘P switcher (filter, open, delete), ⌘K action
   panel (every action listed runs), ⌘F find (matches highlight, Esc pops one
   overlay at a time, never the panel).
7. **Pins + history** — ⇧⌘P pin/unpin persists to sidecar; ⌘1-9 jumps; ⌘[/⌘]
   walk history; deleted notes purge from history.
8. **Delete + undo** — delete swaps to most-recent survivor, toast Undo
   restores the SAME file id (entity identity, not a re-create).
9. **Live sync (two tabs)** — open the app twice; edits in one appear in the
   other (clean), deletes toast "deleted elsewhere"; own-echo never toasts.
   `:4949` is the surface for both dev and release builds. (Historical note:
   until 2026-07-30 the dev proxy forwarded Vite's `101` without splicing the
   upgraded sockets, so the HMR client looped on "server connection lost" and
   a page at `:4949` reloaded ~40×/sec and never mounted —
   `audit-output/REPORT.md` Appendix C1. `proxy_to_vite` now bridges the
   upgrade; `server::tests::dev_proxy_bridges_the_upgraded_websocket_stream`
   guards it. If that regression ever returns, `:1420` is the fallback: it
   serves the identical app and `api.ts` routes its API calls back to 4949.)
10. **Zoom** — ⌘+/⌘-/⌘0 scale and persist; reload keeps zoom.
11. **Click-anywhere** — clicking empty space below content focuses the editor
    with caret at end (regression: fill-height fix).
12. **Empty-doc stability** — ⌘A Delete leaves a working editor; keep typing
    (regression: prosemirror decoration crash class).

Report shape per flow: PASS / FAIL + console errors (`playwright-cli console`)
+ screenshot on FAIL. Findings that aren't fixed on the spot become todos on
the FloatNotes project.

## L3 native checklist (human, ~2 min)

- ⌥N toggles the panel from another app, on every Space, over fullscreen apps
- Title bar drags the panel; position survives hide/show
- Esc behavior matches the sidecar setting (hide vs unfocus)
- "Hide from Screen Share" makes the panel invisible in a screen recording
- Launch at login (SMAppService) after enabling + reboot
- cmux: ⌘⌥N action, `note` CLI capture while app closed → lands in inbox
- Menubar note (ADR 0015): ⌘K "Pin to Menu Bar" puts the title next to the
  tray icon; left-click drops the popover under it, a click elsewhere dismisses
  it, right-click still shows the menu; the pin survives a relaunch

Added by the 2026-07-30 UI/UX audit — surfaces a browser can never reach
(`audit-output/REPORT.md` Appendix A):

- **Corner arcs over light AND dark wallpaper.** The app root is opaque
  `bg-white`, so the four `rounded-xl` corners are the *only* pixels where the
  wallpaper composites. Everything else is checkable in a browser; this isn't.
- **Window resize floor.** Drag the panel narrower than ~381px: the bottom bar
  silently loses the task-list button and the word count, with no scrollbar
  (the root is `overflow-hidden`). No `minWidth` is set in `tauri.conf.json`.
- **Focus restoration after Esc**, in the real panel: open ⌘P, press Esc, then
  type. The keystrokes should land in the note. In the browser surface focus is
  lost to `<body>` entirely — confirm whether the panel behaves the same.
- **⌥N while an overlay is open** — the global shortcut and the overlay stack's
  Esc layering are owned by different layers; only the native panel exercises both.

## Cadence

- **Per-change**: L1 + the L2 flows touching the changed area.
- **Pre-release**: full L2 sweep (agent, ~10 min) + L3 (human, ~2 min).
- L2 needs no fixtures or test IDs — flows use user-visible affordances
  (titles, roles, text), which keeps them honest about the real UX.

## Known environment gotchas

- vitest loads a second `prosemirror-view` (ESM/CJS dual-package) for the
  search plugin — empty-doc editors crash in tests only; production verified
  unaffected. Typing tests exclude `searchAndReplace` (see
  task-input-rule.test.ts). Revisit if the plugin or vitest is upgraded.
- Playwright's `Meta+a` is `ControlOrMeta+a` in run-code.
- The `.tiptap` element is the editable surface; `.floatnotes-editor` is its
  wrapper.
