# ADR 0015: The menubar note is a second panel running the same app

- Status: Accepted
- Date: 2026-09-03

## Context

The tray icon existed only as the way back to the panel (show / hide / quit).
Raycast Notes has one more thing the icon can do: pin a note to the menubar, so
its title sits up there and a click drops the note without summoning the full
panel. The ask was to have that here too.

Three shapes were on the table:

1. Render the pinned note's text into the tray **menu** itself. Read-only, and
   AppKit menus do not host an editor.
2. Left-click on the icon **summons the main panel** on the pinned note. Nothing
   new to build, but the panel is a floating window the user parks somewhere;
   a menubar click that teleports it is the wrong gesture.
3. A **second webview window** under the icon, showing the pinned note in the
   real editor.

## Decision

Option 3. The popover is a second Tauri window (label `menubar`) that loads
the same frontend bundle and goes through the same `to_floatnotes_panel()`
recipe as the main panel (nonactivating, floating, every Space). Three things
are specific to it:

- It **boots on the pinned note** by asking Rust (`get_menubar_note`) instead
  of reading a `?note=` deeplink, and it follows the pin when the main panel
  moves it (`floatnotes://menubar-note`).
- It **dismisses on losing key status** (an `NSWindowDelegate`
  `windowDidResignKey` hook), which is what a menubar popover does and the
  main panel deliberately does not.
- It is **built lazily and then hidden, never destroyed**, like the main panel,
  so its editor state survives between clicks.

The pin itself lives in the sidecar as `menuBarNote`, and the **frontend is
its only writer**. Rust reads it once at boot and is told about changes through
`set_menubar_note` after the sidecar PUT succeeded. A second writer in Rust
would race the frontend's whole-value PUT of the sidecar (the zoom or pin it
wrote a moment later would revert the menubar pin).

The tray title follows the note on disk through the server's existing
broadcast channel: rename re-titles it, delete blanks it, restore brings it
back. No second watcher.

With a note pinned, left-click on the icon is the popover and the menu moves to
right-click; with none pinned, left-click stays the menu, because the menu is
the one always-available way back to a hidden panel.

## Consequences

- `hide_panel` and `unfocus_panel` now act on the **calling** window, so Esc,
  ⌘W and the red light mean "this panel" in both windows. `show_panel` and the
  hotkey still mean the main panel only.
- The `default` capability lists both windows. A third surface would need the
  same line.
- One note in the menubar, not several: the sidecar field is a single id and
  the tray title is one string. More than one is a different feature (a menu
  of pinned notes), not a wider version of this one.
- A tray click that lands within 400 ms of the popover resigning key is
  swallowed: the mouse-down on the icon resigns (and hides) the popover before
  the click event arrives, and without that window the click would re-open
  what the user just closed. Measured, not theorised, once the build ran.
- The popover's title bar still drags. That is the main panel's title bar
  doing its job; a menubar popover that can be dragged away is odd but
  harmless, and reverting it would mean a popover-only title bar.
