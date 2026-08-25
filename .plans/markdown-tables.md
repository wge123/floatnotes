# Add markdown table support to the FloatNotes editor

> Paste this whole file as the opening prompt of a fresh session in
> `/Users/willem/Developer/Personal/floatnotes`. Everything below was verified against the
> installed dependencies on 2026-08-03, not inferred from docs.

## Goal

Markdown tables written in a `~/Notes/*.md` file should render as real tables in the editor, stay
editable, and serialize back to pipe-syntax markdown unchanged. Today they render as one run-on
line of concatenated cell text, because the schema has no table nodes and the markdown-it HTML is
dropped on the floor.

## What the investigation already established

Do not re-derive these. Each was checked directly.

**1. `tiptap-markdown@0.9.0` already ships a full table serializer.** It is not something to write.
`node_modules/tiptap-markdown/dist/tiptap-markdown.es.js` line 499 defines a stub node named
`table` whose `addStorage().markdown.serialize` emits `| a | b |` rows plus the `| --- | --- |`
delimiter. Line 731 registers it in `markdownExtensions`, and `getMarkdownSpec()` matches built-in
specs to editor extensions **by node name**. So any extension registering a node called `table`
inherits the serializer for free.

**2. markdown-it parses pipe tables under the default preset.** Verified empirically with the
installed copy, constructed the same way `tiptap-markdown` constructs it (`markdownit()` with no
preset argument):

```
| a | b |          ->   <table><thead><tr><th>a</th><th>b</th></tr></thead>
| --- | --- |            <tbody><tr><td>1</td><td>2</td></tr></tbody></table>
| 1 | 2 |
```

So the parse path (markdown -> markdown-it -> HTML -> TipTap `parseHTML`) needs no work either.

**3. The only missing piece is the ProseMirror schema.** Four packages, none installed, all
published at **2.27.2**, exactly matching the installed `@tiptap/core` 2.27.2:

```
@tiptap/extension-table         2.27.2
@tiptap/extension-table-row     2.27.2
@tiptap/extension-table-header  2.27.2
@tiptap/extension-table-cell    2.27.2
```

## The decision this feature actually turns on

`isMarkdownSerializable(node)` (same file, line ~549) refuses to emit pipe syntax when **any** of
these hold, and falls through to `HTMLNode.storage.markdown.serialize` instead:

- the first row contains a cell that is not a `tableHeader`
- any cell has `colspan > 1` or `rowspan > 1`
- any cell holds more than one child block

`Markdown` is already configured with `html: true` in `src/lib/editor-extensions.ts` (deliberately,
so the Underline mark survives). That means the fallback **will not error**. It will silently write
a raw `<table>` HTML blob into the user's plain-markdown note.

That is the real design question, and it should be settled before any code lands:

- **Option A, prevent the state.** Do not expose merge/split cell commands, and do not offer a
  "header row off" toggle. Every table the UI can produce stays markdown-serializable. Simplest,
  and it matches a scratch-note app. Recommended.
- **Option B, allow it and warn.** Expose the full table command set, detect the unserializable
  shape, and surface it in `StatusBar.tsx` so the user knows this note is no longer pure markdown.
- **Option C, allow it silently.** Cheapest to build, worst to live with, since the filesystem is
  the source of truth here and other tools read these files.

Record the choice as an ADR in `docs/adr/` (next number is **0013**). ADR 0005
`wysiwyg-markers-consumed` is the closest precedent for how this repo reasons about the
markdown/WYSIWYG boundary; read it first.

## Scope

**In scope**

- Register the four table nodes in `buildEditorExtensions()` in `src/lib/editor-extensions.ts`.
  That function is the single source of truth for both the React editor and the headless test
  editors, so this is the only registration site.
- Round-trip correctness, including idempotency, in `src/lib/markdown-roundtrip.test.ts`.
- Enough CSS in `src/App.css` that a table does not blow out the floating window's width.
- A way to insert a table. Toolbar button in `src/components/FormatBar.tsx`, and/or a keymap entry
  (`src/lib/editor-keymap.ts` for editor-scoped, `src/lib/app-keymap.ts` for app-scoped).

**Out of scope unless it falls out for free**

- Column resizing. `Table.configure({ resizable: true })` installs a drag plugin, and this app has
  its own window-drag logic in `src/lib/drag.ts`. Do not enable it in the first pass.
- Cell merge/split, unless Option B or C is chosen.
- Alignment syntax (`:---`, `:---:`). The bundled serializer emits `---` unconditionally, so
  alignment cannot round-trip without replacing the serializer. Note it as a known limitation.

## Suggested approach

1. `bun add @tiptap/extension-table@2.27.2 @tiptap/extension-table-row@2.27.2 @tiptap/extension-table-header@2.27.2 @tiptap/extension-table-cell@2.27.2`
   (**bun only**, never npm/yarn/pnpm, per the repo's CLAUDE.md.)
2. Register them in `buildEditorExtensions()`. Order matters for extensions that hook others'
   markdown-it rules, as the existing `EmptyTaskParse` comment documents; tables have no such
   dependency, so append them near `TaskItem`.
3. Write the failing round-trip test first, then make it pass. Tests travel in their own commit
   and their own PR by landing time.
4. Style, then insertion UI, then the ADR.

## Acceptance criteria

- `roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |")` returns the input unchanged.
- The "every supported construct" idempotency test in `markdown-roundtrip.test.ts` still passes
  with a table added to the source document.
- A table pasted or opened from disk renders as a table and is editable cell by cell.
- A table wider than the window does not break the layout.
- No test writes raw `<table>` HTML into a `.md` file unless the chosen ADR option permits it.
- `bun run build` clean, `bun test` green.

## Test cases worth writing

- Minimal 2x2 round-trips exactly.
- Idempotency: `roundTrip(roundTrip(x)) === roundTrip(x)`.
- A cell containing inline marks (`**bold**`, `` `code` ``, a link) survives.
- An empty cell. The serializer skips `renderInline` when `textContent.trim()` is falsy, so
  confirm what it actually emits (expect `|  |`) and lock that in.
- A table immediately following a paragraph with no blank line between them.
- A table inside a list item, if the schema even allows it. Establish the behavior rather than
  assuming.
- Whichever unserializable shape the ADR picks: assert the chosen behavior explicitly, so the
  silent-HTML path can never regress unnoticed.

## Files to touch

```
src/lib/editor-extensions.ts        register the four nodes  (the only registration site)
src/lib/markdown-roundtrip.test.ts  round-trip + idempotency  (separate commit)
src/App.css                         table styling and overflow
src/components/FormatBar.tsx        insert-table control
src/lib/editor-keymap.ts            optional shortcut
docs/adr/0013-*.md                  the HTML-fallback decision
package.json                        four new deps
```

## Repo conventions to respect

- **bun only.** Never npm, yarn, or pnpm.
- Branch first. Never commit on `main`. This is small enough for a single `feat/markdown-tables`
  branch landing via `git merge --no-ff`.
- **Tests never share a commit with implementation**, and carry their own PR by landing time.
- Two ports, do not conflate: Vite on 1420, the in-app axum server on 4949. Test a dev build on
  `:1420`, since HMR cannot hold its socket through the proxy.
- Design decisions go in `docs/adr/`, terms in `docs/glossary.md`.

## Why this came up

FloatNotes is the tick surface for handhold run notes. A run note used a markdown table to lay out
three settings against their current state, and it rendered as
`SettingState nowWhat to do**MDBList**tracking ON, key EMPTY...` in one line. Any generated note
has to avoid tables until this ships.

## Adjacent round-trip damage found in the same session

Tables are the loudest symptom, not the only one. Observed on a real note during that run, worth
either folding into this work or splitting into a sibling plan. **No content was lost in any of
these**, which was checked rather than assumed.

**1. Consecutive blockquote lines merge, and bold markers corrupt.** This source:

```markdown
> **Status:** step 1 of 5
> **How Claude verifies:** you export the config
```

came back as one line reading `> ****Status:** step 1 of 5**How Claude verifies:** you export...`,
with four asterisks at the front and the two lines welded together. A multi-line blockquote is a
single ProseMirror blockquote node containing one paragraph, so the newline is not preserved and
the adjacent bold marks re-serialize wrong. Reproduce with two `>` lines that each begin with a
bold run.

**2. Every save rewrites the whole file.** Two behaviors combine:

- Hard-wrapped paragraphs are re-joined into single long lines, so a note authored at 100 columns
  comes back as one line per paragraph.
- Ordered and task list markers gain escapes: `- [ ] 1. Foo` becomes `- [ ] 1\. Foo` on save, and
  the escape appears to accumulate rather than normalize.

Neither loses information, but together they mean opening a note and touching nothing still
produces a full-file diff. That matters here specifically because these notes are watched by
`~/.claude/skills/handhold/scripts/await-tick.sh`, which tracks checkbox **line numbers**, so any
reflow fires spurious `UNTICKED` events for every box in the file.

**Suggested test to add alongside the table tests**, since it is the same round-trip machinery:

```
it("is idempotent for a note that was already saved once", () => {
  const once = roundTrip(source);
  expect(roundTrip(once)).toBe(once);   // catches accumulating escapes
});
```

and a case asserting a two-line blockquote survives, which currently would not.
