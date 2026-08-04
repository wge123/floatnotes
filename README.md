# FloatNotes

Floating markdown scratch-notes app for macOS — a free, local-first take on Raycast Notes.

- **Stack:** Tauri 2 + React + TypeScript + Vite + Tailwind CSS 4, managed with bun
- **Notes live in** `~/Notes` (override with `FLOATNOTES_DIR`) as plain markdown files
- **Dev server port:** 4949

## Friendly local URL

The app answers on `http://localhost:4949`. To reach it as `http://notes.test:4949`
instead, add the alias to `/etc/hosts` once per machine:

```sh
echo '127.0.0.1 notes.test' | sudo tee -a /etc/hosts
```

That is the whole setup: `notes.test` is a loopback alias, not DNS, so it only
resolves on machines carrying that line. `scripts/notes-open.sh` (aliased to
`notesopen`, and the cmux **Preview** palette action) prefers the alias when the
line is present and falls back to `localhost` with a warning when it is not.

Use `.test`, not `.local`. macOS routes every `.local` name to mDNSResponder
before it consults `/etc/hosts`, so `notes.local` resolves correctly only after
Bonjour times out: measured at 5.07s per lookup on this machine against 0.02s
for a normal hosts entry. `.test` is IANA-reserved and never touches mDNS.

## Develop

```sh
bun install
bun run tauri dev
```

## Build / check

```sh
bun run build                                       # typecheck + bundle frontend
cargo check --manifest-path src-tauri/Cargo.toml    # fast Rust check
```

Design decisions are recorded in `docs/adr/`; project conventions in `CLAUDE.md`.
