# FloatNotes

Floating markdown scratch-notes app for macOS (free Raycast-Notes-style replacement).

## Stack

- Tauri 2 (Rust backend, `src-tauri/`)
- React 19 + TypeScript + Vite (frontend, `src/`)
- Tailwind CSS 4 (`@tailwindcss/vite` plugin) + `@tailwindcss/typography`
- Package manager / runtime: **bun** (never npm/yarn/pnpm)

## Conventions

- **Two ports, don't conflate them.** Vite binds **1420** (`vite.config.ts` `server.port`, `strictPort`) and that is what `tauri.conf.json` `devUrl` points at. The in-app axum server binds **4949** (`src-tauri/src/server.rs` `DEFAULT_PORT`, `FLOATNOTES_PORT` override) and proxies to Vite in dev, so `http://localhost:4949/` is the browser surface. Keep `vite.config.ts` `server.port` and `server.rs` `VITE_DEV_PORT` in sync. Against a *dev* build, test on `:1420` — HMR can't hold its socket through the proxy (`docs/ux-testing.md`).
- **Notes directory: `~/Notes`**, overridable via the `FLOATNOTES_DIR` env var. Notes are plain markdown files; the filesystem is the source of truth.
- Deleted notes move to `<notes-dir>/.trash/`, never hard-deleted (ADR 0004).
- Design decisions live in `docs/adr/`; terms in `docs/glossary.md`. Read the ADRs before changing global-shortcut, storage, or startup behavior.

## Reference

- Studied upstream: `~/Developer/Study/.dossiers/stablyai__orca.md` (repo dossier for stablyai/orca — its TipTap 3 markdown editor is the reference for ours, ADR 0019).

## Commands

- `bun run tauri dev` — run the app (Tauri shell + Vite on 1420 + the in-app axum server on 4949)
- `bun run build` — typecheck + bundle frontend
- `cargo check --manifest-path src-tauri/Cargo.toml` — fast Rust check

## Agent skills

### Issue tracker

Second-brain store, area `FloatNotes`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles, applied as store tags. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `docs/glossary.md` + `docs/adr/`. See `docs/agents/domain.md`.
