import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Editor as TiptapEditor } from "@tiptap/react";

import ActionPanel, { type Action } from "./components/ActionPanel";
import Editor from "./components/Editor";
import FindBar from "./components/FindBar";
import NoteSwitcher from "./components/NoteSwitcher";
import StatusBar from "./components/StatusBar";
import { api, type Note, type Sidecar } from "./lib/api";
import {
  installAppKeymap,
  pushOverlay,
  removeOverlay,
  topOverlay,
  type AppCommand,
  type OverlayEntry,
} from "./lib/app-keymap";
import { saveWithConflictReload } from "./lib/autosave";
import {
  back,
  current,
  emptyHistory,
  forward,
  purge,
  visit,
  type NoteHistory,
} from "./lib/history";
import "./App.css";

const AUTOSAVE_MS = 500;
const TOAST_MS = 3000;
/** Spec (step 06): the delete-undo toast lingers longer than info toasts. */
const UNDO_TOAST_MS = 5000;

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

type OverlayId = "switcher" | "action-panel" | "find";

/**
 * App shell (steps 05–06): one visible note wired to the localhost server,
 * plus the notes-UX overlays — ⌘P switcher, ⌘K action panel, ⌘F find,
 * ⇧⌘P pins (sidecar-persisted), ⌘[/⌘] visit history, delete with 5s undo.
 */
function App() {
  const [note, setNote] = useState<Note | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [undoDelete, setUndoDelete] = useState<{
    title: string;
    undo: () => void;
  } | null>(null);
  const [overlays, setOverlays] = useState<readonly OverlayId[]>([]);
  const [sidecar, setSidecar] = useState<Sidecar>({
    pins: [],
    order: [],
    zoom: null,
  });
  const editorRef = useRef<TiptapEditor | null>(null);

  // Latest values for callbacks that outlive a render (keymap, debounce).
  const noteRef = useRef<Note | null>(null);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);
  const sidecarRef = useRef(sidecar);
  useEffect(() => {
    sidecarRef.current = sidecar;
  }, [sidecar]);
  const historyRef = useRef<NoteHistory>(emptyHistory);

  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // ------------------------------------------------------------- overlays
  // The pure stack in app-keymap owns Esc layering; React state only mirrors
  // which overlays are visible.
  const overlayStack = useRef<readonly OverlayEntry[]>([]);

  const closeOverlay = useCallback((id: OverlayId) => {
    overlayStack.current = removeOverlay(overlayStack.current, id);
    setOverlays((open) => open.filter((o) => o !== id));
  }, []);

  const openOverlay = useCallback((id: OverlayId) => {
    overlayStack.current = pushOverlay(overlayStack.current, {
      id,
      close: () => setOverlays((open) => open.filter((o) => o !== id)),
    });
    setOverlays((open) => (open.includes(id) ? open : [...open, id]));
  }, []);

  const toggleOverlay = useCallback(
    (id: OverlayId) => {
      if (overlays.includes(id)) {
        closeOverlay(id);
      } else {
        openOverlay(id);
      }
    },
    [overlays, openOverlay, closeOverlay],
  );

  // ------------------------------------------------------------ note flow
  /** Open a note; `record` visits it in ⌘[/⌘] history (default true). */
  const openNote = useCallback((next: Note, record = true) => {
    setNote(next);
    if (record) historyRef.current = visit(historyRef.current, next.id);
  }, []);

  const openNoteById = useCallback(
    async (id: string, record = true) => {
      try {
        openNote(await api.read(id), record);
      } catch (error) {
        showToast(`could not open note: ${error}`);
      }
    },
    [openNote, showToast],
  );

  // Boot: most-recent note, or create the empty "Untitled" note (ADR 0002).
  useEffect(() => {
    let cancelled = false;
    bootNote()
      .then((booted) => {
        if (!cancelled) openNote(booted);
      })
      .catch((error: unknown) => {
        // Visible failure over a silently empty panel.
        if (!cancelled) setBanner(`FloatNotes could not load notes: ${error}`);
      });
    api
      .sidecarLoad()
      .then((loaded) => {
        if (!cancelled) setSidecar(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(`could not load pins: ${error}`);
      });
    return () => {
      cancelled = true;
    };
  }, [openNote, showToast]);

  const flushSave = useCallback(
    async (markdown: string) => {
      const currentNote = noteRef.current;
      if (!currentNote) return;
      try {
        const outcome = await saveWithConflictReload(
          currentNote.id,
          markdown,
          currentNote.mtime,
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
        showToast(
          `save failed: ${error instanceof Error ? error.message : error}`,
        );
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

  // --------------------------------------------------------------- pins
  const persistSidecar = useCallback(
    (next: Sidecar) => {
      setSidecar(next);
      api.sidecarSave(next).catch((error: unknown) => {
        showToast(`could not save pins: ${error}`);
      });
    },
    [showToast],
  );

  const togglePin = useCallback(
    (id: string) => {
      const prev = sidecarRef.current;
      const pinned = prev.pins.includes(id);
      persistSidecar({
        ...prev,
        pins: pinned ? prev.pins.filter((p) => p !== id) : [...prev.pins, id],
      });
      showToast(pinned ? "unpinned" : "pinned");
    },
    [persistSidecar, showToast],
  );

  // ------------------------------------------------------ delete + undo
  const undoTimer = useRef<number | undefined>(undefined);
  const deleteWithUndo = useCallback(
    async (target: Note) => {
      try {
        await api.remove(target.id);
      } catch (error) {
        showToast(`delete failed: ${error}`);
        return;
      }
      historyRef.current = purge(historyRef.current, target.id);
      // Deleting the visible note swaps in the most recent survivor.
      if (noteRef.current?.id === target.id) {
        try {
          const metas = await api.list();
          openNote(
            metas.length > 0
              ? await api.read(metas[0].id)
              : await api.create(""),
          );
        } catch (error) {
          setBanner(`FloatNotes could not load notes: ${error}`);
        }
      }
      setUndoDelete({
        title: target.title,
        undo: () => {
          window.clearTimeout(undoTimer.current);
          setUndoDelete(null);
          api
            .restore(target.id)
            .then((restored) => openNote(restored))
            .catch((error: unknown) => showToast(`undo failed: ${error}`));
        },
      });
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(
        () => setUndoDelete(null),
        UNDO_TOAST_MS,
      );
    },
    [openNote, showToast],
  );

  // ------------------------------------------------------------ commands
  const newNote = useCallback(async () => {
    try {
      openNote(await api.create(""));
    } catch (error) {
      showToast(`could not create note: ${error}`);
    }
  }, [openNote, showToast]);

  const onCommand = useCallback(
    (command: AppCommand) => {
      const currentNote = noteRef.current;
      switch (command.kind) {
        case "new-note":
          void newNote();
          break;
        case "toggle-switcher":
          toggleOverlay("switcher");
          break;
        case "toggle-pin":
          if (currentNote) togglePin(currentNote.id);
          break;
        case "pinned-jump": {
          const id = sidecarRef.current.pins[command.index];
          if (id) void openNoteById(id);
          break;
        }
        case "zoom-reset":
          // ⌘0 reserved — zoom ships in step 09.
          break;
        case "history-back": {
          const moved = back(historyRef.current);
          if (moved !== historyRef.current) {
            historyRef.current = moved;
            const id = current(moved);
            if (id) void openNoteById(id, false);
          }
          break;
        }
        case "history-forward": {
          const moved = forward(historyRef.current);
          if (moved !== historyRef.current) {
            historyRef.current = moved;
            const id = current(moved);
            if (id) void openNoteById(id, false);
          }
          break;
        }
        case "action-panel":
          toggleOverlay("action-panel");
          break;
        case "find":
          openOverlay("find");
          break;
      }
    },
    [newNote, toggleOverlay, togglePin, openNoteById, openOverlay],
  );

  // App keymap: Esc closes the top overlay / hides the panel; ⌘W hides;
  // step-06 chords land in onCommand.
  useEffect(
    () =>
      installAppKeymap({
        overlayDepth: () => overlayStack.current.length,
        closeTopOverlay: () => {
          const top = topOverlay(overlayStack.current);
          if (!top) return;
          overlayStack.current = removeOverlay(overlayStack.current, top.id);
          top.close();
        },
        onCommand,
      }),
    [onCommand],
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

  // ⌘K actions — declared here, filtered/run by ActionPanel.
  const actions: Action[] = [
    { id: "new", label: "New Note", shortcut: "⌘N", run: () => void newNote() },
    {
      id: "duplicate",
      label: "Duplicate Note",
      run: () => {
        const n = noteRef.current;
        if (!n) return;
        api
          .create(n.content)
          .then((copy) => openNote(copy))
          .catch((error: unknown) => showToast(`duplicate failed: ${error}`));
      },
    },
    {
      id: "pin",
      label: note && sidecar.pins.includes(note.id) ? "Unpin Note" : "Pin Note",
      shortcut: "⇧⌘P",
      run: () => {
        if (noteRef.current) togglePin(noteRef.current.id);
      },
    },
    {
      id: "delete",
      label: "Delete Note",
      run: () => {
        if (noteRef.current) void deleteWithUndo(noteRef.current);
      },
    },
    {
      id: "copy-markdown",
      label: "Copy Markdown",
      run: () => {
        const n = noteRef.current;
        if (!n) return;
        navigator.clipboard
          .writeText(n.content)
          .then(() => showToast("markdown copied"))
          .catch((error: unknown) => showToast(`copy failed: ${error}`));
      },
    },
    {
      id: "copy-deeplink",
      label: "Copy Deeplink",
      run: () => {
        const n = noteRef.current;
        if (!n) return;
        navigator.clipboard
          .writeText(`http://localhost:4949/?note=${n.id}`)
          .then(() => showToast("deeplink copied"))
          .catch((error: unknown) => showToast(`copy failed: ${error}`));
      },
    },
    {
      id: "browse",
      label: "Browse Notes",
      shortcut: "⌘P",
      run: () => openOverlay("switcher"),
    },
    {
      id: "find",
      label: "Find in Note",
      shortcut: "⌘F",
      run: () => openOverlay("find"),
    },
  ];

  return (
    <div className="relative flex h-screen flex-col overflow-hidden rounded-xl bg-white">
      {banner && (
        <div className="shrink-0 bg-red-700 px-3 py-2 text-xs text-white">
          {banner}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {note && (
          <Editor
            key={note.id}
            value={note.content}
            onChange={onEdit}
            onReady={(editor) => {
              editorRef.current = editor;
            }}
            placeholder="Start typing…"
          />
        )}
      </div>
      {overlays.includes("find") && editorRef.current && (
        <FindBar
          editor={editorRef.current}
          onClose={() => closeOverlay("find")}
        />
      )}
      <StatusBar markdown={note?.content ?? ""} />
      {overlays.includes("switcher") && (
        <NoteSwitcher
          pins={sidecar.pins}
          currentNoteId={note?.id ?? null}
          onOpen={(picked) => {
            closeOverlay("switcher");
            openNote(picked);
          }}
          onDelete={(target) => void deleteWithUndo(target)}
          onClose={() => closeOverlay("switcher")}
        />
      )}
      {overlays.includes("action-panel") && (
        <ActionPanel
          actions={actions}
          onClose={() => closeOverlay("action-panel")}
        />
      )}
      {undoDelete && (
        <div className="fixed inset-x-0 bottom-10 z-50 flex justify-center">
          <div className="flex items-center gap-3 rounded-lg bg-gray-900/90 px-4 py-2 text-xs text-white shadow-lg">
            <span>deleted “{undoDelete.title}”</span>
            <button
              type="button"
              onClick={undoDelete.undo}
              className="font-semibold text-blue-300 hover:text-blue-200"
            >
              Undo
            </button>
          </div>
        </div>
      )}
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
