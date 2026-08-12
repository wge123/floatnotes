# ADR 0014: Reveal-on-caret lands as decorations only

- Status: Accepted
- Date: 2026-08-12
- Supersedes the deferral in [ADR 0005](0005-wysiwyg-markers-consumed.md)

## Context

ADR 0005 shipped v1 with markdown markers consumed and deferred Obsidian-style
reveal-on-caret as post-v1, on the grounds that it is "a substantial custom
ProseMirror extension, easily the largest single chunk of S04". That judgment
was about v1 timeline risk, not about the feature being wrong.

The deferral held. v1 shipped, the editor is in daily use, and the escape hatch
0005 named (edit the file in nvim, the watcher propagates) turned out to be the
thing people reach for when they want to see syntax.

## Decision

Reveal-on-caret ships as **decorations only**. The markers are ProseMirror
widget decorations computed from the current selection. They are never document
content, never nodes, never marks.

That single constraint is what makes this safe enough to land as a Low-priority
enhancement against an editor holding the user's live notes:

- `getMarkdown()` is byte-identical whether or not the caret sits inside styled
  text, so no caret movement can reach the file on disk. Tests assert this
  directly, including a sweep that parks the caret at every valid position in a
  mixed document and compares the serialization before and after.
- The storage model is untouched. 0005 predicted "no storage or API change,
  purely an editor extension", and that held exactly.

The revealed strings are the ones tiptap-markdown's serializer actually emits
(`**`, `*`, `` ` ``, `~~`, and `#` scaled to heading level), read off the
configuration in `editor-extensions.ts` rather than chosen independently.
Revealing syntax the save path would not write would teach the wrong thing.

Two behavioural limits, both deliberate:

- **Collapsed caret only.** Across a range selection the user is acting on a
  span rather than editing inside one, and injecting widgets mid-selection makes
  the highlight read as covering characters that are not in the document.
- **Inline marks and heading prefixes only.** List bullets, blockquote markers
  and table pipes are block scaffolding that the editor already renders
  structurally; revealing them would be noise rather than syntax the user is
  about to edit.

## Consequences

- The extension is ~120 lines, not the "largest single chunk" 0005 feared. The
  cost estimate was made against a design that reveals everything; scoping to
  marks plus headings is most of the value for a fraction of the surface.
- `markerSpecs(state)` is a pure function returning data, kept separate from the
  plugin so the behaviour is testable without a view. The plugin wrapper is
  covered separately by mounted-editor tests that read the DOM, because a
  correct computation that is never wired in renders nothing.
- Markers carry `contenteditable="false"` and `aria-hidden="true"`, and
  `user-select: none` in CSS. Without those the caret would walk into characters
  the document does not contain, a screen reader would announce syntax as prose,
  and a select-all copy would carry marker characters into the clipboard.
- If a future change adds a mark type, its marker belongs in `MARK_MARKERS` in
  `lib/reveal-markers.ts` and nowhere else.
