# ADR 0003: Always-on via login item, not a split server daemon

- Status: Accepted
- Date: 2026-07-22

## Context

The axum server (REST + WS + static UI on `127.0.0.1:4949`) lives inside the
Tauri app process. Every non-panel surface — cmux browser surfaces, ⌘⌥N,
deeplinks, API-path `note` capture — depends on that process being alive. The
blueprint's S08 left launch-at-login "to the user," which made always-on
availability an accident of habit rather than a property of the system.

## Decision

We will make FloatNotes a login item as an explicit S08 task (a user-queue
moment in System Settings, or `SMAppService` if trivial). The server stays
in-process; we will NOT split it into a standalone LaunchAgent daemon.

## Consequences

- `localhost:4949` is up from login, so cmux wiring (S07) and deeplinks can
  assume the server exists; connection-refused becomes an anomaly, not a mode.
- One process, one lifecycle — no IPC layer, no daemon/app version skew.
- Cost: the full app (WebView included) is always resident, not just a server;
  accepted for a utility this small.
- `note`'s direct file-append fallback (S07) remains for the genuinely-down
  case but is no longer a daily path.
- S08's task list and S09's acceptance checklist gain "login item enabled,
  survives reboot" as a check.
