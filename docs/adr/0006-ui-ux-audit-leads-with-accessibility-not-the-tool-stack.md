# ADR 0006: The UI/UX audit leads with accessibility, not the tool stack

- Status: Accepted
- Date: 2026-07-30

## Context

The UI/UX audit plan (`.plans/ui-ux-audit.md`) selects a tool stack built for
multi-page web products: `design-audit.mjs` (rendered geometry and color across a
viewport ladder), `hallmark` (57 generic-AI-aesthetic gates over source), and a
7-phase model-judged browser review. FloatNotes is the opposite shape — one screen,
8 components, 88 lines of CSS, no theme system, no breakpoints, and a visual language
that is already minimal and hand-tuned.

Reading the source before running anything surfaced a cluster of likely defects that
none of those three tools probes hard: no `focus-visible` styling anywhere in the app
against an editor that sets `outline: none`, both overlays rendered as plain `div`s
with no `role="dialog"` / `aria-modal` / focus trap / focus restore, a 420px-wide
switcher modal inside a 420px window, and no empty or loading state for the note body.
The tension: the stack that was chosen measures aesthetics and geometry well and
`keyboard reachability` barely at all.

## Decision

We will make keyboard operation, focus visibility, and dialog semantics the **primary
axis** of the audit. The tool stack still runs in full and still produces its own
findings, but its role is confirmation and aesthetic backstop rather than lead.

The `evidence tagging` discipline from the plan is unchanged and applies to both:
every finding carries `measured` or `model-judged`, and model-judged findings never
gate the verdict on their own. A11y findings that rest on a measured value (a computed
contrast ratio, a missing DOM attribute, an element's rendered width) are `measured`;
ones resting on reviewer judgment about user impact are `model-judged`.

The rejected alternative worth naming is "two coequal tracks" — it was the most
thorough option, but it costs roughly 45 extra minutes and requires inventing a
tie-break rule for when the tracks disagree, which is complexity the verdict doesn't
need on an app this size.

## Consequences

- The audit's most valuable output is likely a list of concrete, cheap a11y fixes
  rather than a design critique. That is the point, but it means the report will read
  as less "design review" than the plan's title suggests.
- Part of the verdict rests on judgment the tool stack cannot reproduce. Mitigated by
  the source tagging: a reader can always see which findings are measured.
- `hallmark` and the 7-phase review may return thin results. That is an acceptable and
  expected outcome here, not a sign the run failed — a thin aesthetic report on an
  88-line stylesheet is information.
- If the a11y pass finds little, the audit still has the tool stack's output to fall
  back on, so this choice does not create a single point of failure.
