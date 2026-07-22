# ADR 0002: Start fresh — no migration of Raycast Notes content

- Status: Accepted
- Date: 2026-07-22

## Context

With ⌥N handed to FloatNotes immediately (ADR 0001), the notes accumulated
inside Raycast Notes lose their daily entry point. Options were a one-time
manual export into `~/Notes`, a scripted importer, or no migration at all.

## Decision

We will start `~/Notes` empty. Existing Raycast Notes content stays where it
is, as an archive opened on demand through the Raycast app itself. No importer
is built and no export session is scheduled; if an individual old note turns
out to matter, the user copies it over by hand at that moment.

## Consequences

- Zero migration code or export chores; S05a boots against a genuinely empty
  notes dir (the "create Untitled on first boot" path gets exercised for real).
- Old notes remain siloed in Raycast's internal store — searchable only there.
  ⌘P/⌘F in FloatNotes will never surface pre-2026-07 notes.
- If the archive later proves annoying, a manual export into `~/Notes` remains
  possible at any time (the watcher indexes dropped files); that would be a
  new decision, not a reversal of this one.
