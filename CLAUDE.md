# FloatNotes

Floating markdown scratch-notes app for macOS (free Raycast-Notes-style replacement).

## Stack

- Tauri 2 (Rust backend, `src-tauri/`)
- React 19 + TypeScript + Vite (frontend, `src/`)
- Tailwind CSS 4 (`@tailwindcss/vite` plugin) + `@tailwindcss/typography`
- Package manager / runtime: **bun** (never npm/yarn/pnpm)

## Conventions

- **Dev server port: 4949** (`vite.config.ts` + `tauri.conf.json` devUrl — keep in sync).
- **Notes directory: `~/Notes`**, overridable via the `FLOATNOTES_DIR` env var. Notes are plain markdown files; the filesystem is the source of truth.
- Deleted notes move to `<notes-dir>/.trash/`, never hard-deleted (ADR 0004).
- Design decisions live in `docs/adr/`; terms in `docs/glossary.md`. Read the ADRs before changing global-shortcut, storage, or startup behavior.

## Reference

- Studied upstream: `~/Developer/Study/.dossiers/willzeng274__free-raycast-notes.md` (repo dossier for willzeng274/free-raycast-notes — architecture, gotchas, patterns to borrow).

## Commands

- `bun run tauri dev` — run the app (starts Vite on 4949 + the Tauri shell)
- `bun run build` — typecheck + bundle frontend
- `cargo check --manifest-path src-tauri/Cargo.toml` — fast Rust check
