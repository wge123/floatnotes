# ADR 0011: Contrast is a deterministic verdict, despite the transparent window

- Status: Accepted
- Date: 2026-07-30

## Context

The audit plan listed "contrast findings unreliable under `transparent: true`" as a HIGH
risk, on the reasoning that the true backdrop of a transparent window is the user's
wallpaper — unknowable at audit time — so `design-audit.mjs`'s "nearest opaque
background" approximation could only produce leads. Its mitigation was to re-run the
contrast pass against controlled light and dark backdrops in Phase 3.

Inspecting the render tree shows the premise is much narrower than assumed. The app root
is `<div className="relative flex h-screen flex-col overflow-hidden rounded-xl bg-white">`
— `bg-white` is fully opaque and fills the viewport. `src/App.css:20-23` makes only
`html, body` transparent, and it does so specifically so that container can draw its own
rounded corners. Both overlay panels (`NoteSwitcher`, `ActionPanel`) are likewise opaque
`bg-white` cards, and their scrims (`bg-black/20`, `bg-black/10`) composite over that
same opaque white.

The wallpaper therefore shows through at the four corner arcs and nowhere else, and no
text is rendered there.

Unlike the other decisions in this interview, this one was not a judgment call put to the
user — it is a factual correction resting on directly verified source.

## Decision

Contrast is treated as a **deterministic, measured verdict** across the whole UI.
`design-audit.mjs`'s computed ratios are taken at face value and may gate the verdict
like any other `measured` finding.

The plan's controlled-backdrop workaround is dropped from Phase 3. One screenshot over a
light wallpaper and one over a dark wallpaper are still captured, scoped to the corner
arcs only, where compositing genuinely is wallpaper-dependent.

The plan's HIGH risk entry "contrast findings unreliable under transparent: true" is
downgraded to LOW and rescoped to the corner arcs.

## Consequences

- Phase 3 gets shorter and the audit gains a class of hard findings it would otherwise
  have had to hedge — the `text-gray-400`-on-white values in `NoteSwitcher`,
  `ActionPanel`, and `FindBar` can be reported as WCAG failures rather than leads.
- If the app later gains real translucency — a vibrancy/blur backdrop, a
  `bg-white/80` container, a dark mode over transparent — this ADR's premise breaks and
  the original concern returns in full. The premise to re-check is exactly one thing:
  whether the app root is still opaque.
- The two corner-arc screenshots are cheap and preserve some evidence for that surface
  without the cost of a full controlled-backdrop pass.
