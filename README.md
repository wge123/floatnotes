# FloatNotes

Floating markdown scratch-notes app for macOS — a free, local-first take on Raycast Notes.

- **Stack:** Tauri 2 + React + TypeScript + Vite + Tailwind CSS 4, managed with bun
- **Notes live in** `~/Notes` (override with `FLOATNOTES_DIR`) as plain markdown files
- **Dev server port:** 4949

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
