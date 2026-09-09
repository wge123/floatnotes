# FloatNotes

A floating markdown scratch-notes app for macOS. Local-first, no account, no sync service: your notes are plain `.md` files in a folder you already own.

It started as a free take on Raycast Notes, built because a note-taking tool that holds your thinking should not require a subscription or put your files in someone else's database. It is in daily use.

**Stack:** Tauri 2, React, TypeScript, Vite, Tailwind CSS 4, built with bun. Rust on the back, roughly 160 files.

## What it does

- **Notes are files.** Everything lives in `~/Notes` (override with `FLOATNOTES_DIR`) as plain markdown. Edit them in any other editor and FloatNotes picks the changes up.
- **Floats above your work.** A always-on-top window and a menu-bar note, reachable without leaving what you are doing.
- **Command palette** for jumping between notes, plus a quick-capture path for getting a thought down before it evaporates.
- **Real markdown editing**, including task lists that write `- [x]` back to the file, so a checklist ticked here is a checklist ticked on disk.
- **Serves on localhost**, so other local tools can open a note by URL.

## Accessibility

The interface went through a dedicated accessibility pass rather than an afterthought one: focus restoration when overlays close, dialog semantics and focus trapping on modals, contrast fixes on every sub-AA pairing, visible focus rings, and no hover-only affordances. The reasoning is written up in `docs/adr/0006-ui-ux-audit-leads-with-accessibility-not-the-tool-stack.md`.

## Develop

```sh
bun install
bun run tauri dev
```

## Build and check

```sh
bun run build                                       # typecheck + bundle frontend
cargo check --manifest-path src-tauri/Cargo.toml    # fast Rust check
```

## Friendly local URL

The app answers on `http://localhost:4949`. To reach it as `http://notes.test:4949` instead, add a loopback alias once per machine:

```sh
echo '127.0.0.1 notes.test' | sudo tee -a /etc/hosts
```

`scripts/notes-open.sh` (aliased to `notesopen`) prefers the alias when that line is present and falls back to `localhost` with a warning when it is not.

Use `.test`, not `.local`. macOS routes every `.local` name to mDNSResponder before it consults `/etc/hosts`, so `notes.local` resolves only after Bonjour times out: measured at 5.07s per lookup against 0.02s for a normal hosts entry. `.test` is IANA-reserved and never touches mDNS.

## Project notes

Design decisions are recorded in `docs/adr/`. Project conventions live in `CLAUDE.md`.
