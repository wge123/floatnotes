import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import Editor from "./components/Editor";
import StatusBar from "./components/StatusBar";
import { api, type Note } from "./lib/api";
import {
  installAppKeymap,
  removeOverlay,
  topOverlay,
  type OverlayEntry,
} from "./lib/app-keymap";
import { saveWithConflictReload } from "./lib/autosave";
import "./App.css";

const AUTOSAVE_MS = 500;
const TOAST_MS = 3000;

/**
 * Boot singleton: StrictMode double-runs the boot effect, and two concurrent
 * list→create races each create an "Untitled" note. Both runs must share ONE
 * promise so the create happens at most once per page load.
 */
let bootPromise: Promise<Note> | null = null;

function bootNote(): Promise<Note> {
  bootPromise ??= (async () => {
    const metas = await api.list(); // newest first
    return metas.length > 0 ? api.read(metas[0].id) : api.create("");
  })();
  return bootPromise;
}

/**
 * App shell (step 05): one visible note, wired to the localhost server.
 * Boot opens the most-recently-updated note or creates "Untitled" (ADR
 * 0002); edits auto-save (500ms debounce) via PUT; a 409 reloads the disk
 * version and toasts — never clobbers. No localStorage anywhere.
 */
function App() {
  const [note, setNote] = useState<Note | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Latest id/mtime for the debounced save (state reads would be stale).
  const noteRef = useRef<Note | null>(null);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // Boot: most-recent note, or create the empty "Untitled" note (ADR 0002).
  useEffect(() => {
    let cancelled = false;
    bootNote()
      .then((booted) => {
        if (!cancelled) setNote(booted);
      })
      .catch((error: unknown) => {
        // Visible failure over a silently empty panel.
        if (!cancelled) setBanner(`FloatNotes could not load notes: ${error}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flushSave = useCallback(
    async (markdown: string) => {
      const current = noteRef.current;
      if (!current) return;
      try {
        const outcome = await saveWithConflictReload(
          current.id,
          markdown,
          current.mtime,
        );
        if (outcome.kind === "saved") {
          // Merge mtime/title only — the user may have typed since the PUT.
          setNote((n) =>
            n && n.id === outcome.note.id
              ? { ...n, mtime: outcome.note.mtime, title: outcome.note.title }
              : n,
          );
        } else {
          // 409 → the disk version wins wholesale.
          setNote(outcome.note);
          showToast("reloaded — changed on disk");
        }
      } catch (error) {
        showToast(`save failed: ${error instanceof Error ? error.message : error}`);
      }
    },
    [showToast],
  );

  const saveTimer = useRef<number | undefined>(undefined);
  const onEdit = useCallback(
    (markdown: string) => {
      setNote((n) => (n ? { ...n, content: markdown } : n));
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(
        () => void flushSave(markdown),
        AUTOSAVE_MS,
      );
    },
    [flushSave],
  );

  // App keymap: Esc closes the top overlay / hides the panel; ⌘W hides.
  // No overlays exist yet in this step — S05b pushes onto this stack.
  const overlaysRef = useRef<readonly OverlayEntry[]>([]);
  useEffect(
    () =>
      installAppKeymap({
        overlayDepth: () => overlaysRef.current.length,
        closeTopOverlay: () => {
          const top = topOverlay(overlaysRef.current);
          if (!top) return;
          overlaysRef.current = removeOverlay(overlaysRef.current, top.id);
          top.close();
        },
      }),
    [],
  );

  // Rust-side warnings surface as an in-panel banner (was panel-keys.ts).
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlistens = Promise.all([
      listen<string>("floatnotes://hotkey-warning", ({ payload }) =>
        setBanner(payload),
      ),
      listen<string>("floatnotes://server-error", ({ payload }) =>
        setBanner(payload),
      ),
    ]);
    return () => {
      void unlistens.then((fns) => fns.forEach((unlisten) => unlisten()));
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl bg-white">
      {banner && (
        <div className="shrink-0 bg-red-700 px-3 py-2 text-xs text-white">
          {banner}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {note && (
          <Editor
            value={note.content}
            onChange={onEdit}
            placeholder="Start typing…"
          />
        )}
      </div>
      <StatusBar markdown={note?.content ?? ""} />
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 flex justify-center">
          <div className="rounded-lg bg-gray-900/90 px-4 py-2 text-xs text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
