# ADR 0005: Pure WYSIWYG — markdown markers are consumed, not revealed on caret

- Status: Accepted
- Date: 2026-07-22

## Context

Research left one editor-feel question open: whether styled text should
re-reveal its raw markdown markers when the caret enters it (Obsidian's live
preview) or keep them consumed (TipTap's default; the likely Raycast Notes
behavior). Reveal-on-caret is not a toggle in TipTap — it is a substantial
custom ProseMirror extension, easily the largest single chunk of S04.

## Decision

We will ship v1 with markers consumed: typing a trigger (`# `, `**bold**`,
`- `) converts to styled content and the markers exist only in the `.md` file
on disk. Unformatting happens via the keymap (⌘B etc.), not by editing raw
syntax. Obsidian-style reveal-on-caret is explicitly **tracked as a post-v1
enhancement**, not rejected — see the backlog todo.

## Consequences

- S04 stays at its planned size (extension set + keymap + round-trip tests);
  no custom decoration plugin, no v1 timeline risk.
- Raw-markdown muscle memory (arrow-into-a-heading-and-edit-the-`#`) won't
  work in the panel; the escape hatch is editing the file in nvim, which the
  watcher propagates live.
- If reveal-on-caret lands later, it layers on top of the same
  markdown-on-disk model — no storage or API change, purely an editor
  extension (`tiptap-markdown` content round-trip is unaffected).
