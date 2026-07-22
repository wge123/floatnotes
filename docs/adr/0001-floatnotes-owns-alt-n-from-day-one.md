# ADR 0001: FloatNotes takes over ⌥N immediately (no transition chord)

- Status: Accepted
- Date: 2026-07-22

## Context

The user runs Raycast Notes today, on ⌥N. The reviewed blueprint (S02) ducked the
conflict: it verifies the panel with a known-free chord (`ctrl+alt+cmd+n`) and
"leaves the swap to the user" after final acceptance (S09). That left the cutover
moment undefined — the vaguest point in an otherwise deterministic plan.

## Decision

We will hand ⌥N to FloatNotes immediately: the user disables Raycast Notes'
hotkey before S02 verification, and FloatNotes registers `alt+n` as its real
default from the first panel build onward. The interview's recommended option
(keep Raycast Notes on ⌥N until S09 acceptance, verify on a throwaway chord)
was overruled in favor of early dogfooding — living with the half-built app is
the fastest way to find feel problems the acceptance checklist wouldn't.

## Consequences

- S02's exit criteria run against the real chord (⌥N), not `ctrl+alt+cmd+n`;
  the `FLOATNOTES_HOTKEY` override remains as an escape hatch, not the test path.
- "Disable Raycast Notes' ⌥N binding" becomes a user-only manual-queue item that
  must land **before** S02 verification, or the registration-conflict warning
  path fires on every launch.
- Between S02 and S05a, ⌥N summons a panel that can't yet persist notes — the
  user accepts a degraded notes hotkey during the build window.
- Raycast Notes stays installed (content still readable there) but loses its
  entry point; content migration is a separate decision.
