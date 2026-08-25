import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Editor as TiptapEditor } from "@tiptap/react";

import ActionPanel, { type Action } from "./components/ActionPanel";
import Editor from "./components/Editor";
import FindBar from "./components/FindBar";
import FormatBar from "./components/FormatBar";
import NoteSwitcher from "./components/NoteSwitcher";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import { api, type Note, type Sidecar } from "./lib/api";
import {
  hidePanel,
  installAppKeymap,
  pushOverlay,
  removeOverlay,
  topOverlay,
  unfocusPanel,
  type AppCommand,
  type OverlayEntry,
} from "./lib/app-keymap";
import { saveWithConflictReload, type SaveApi } from "./lib/autosave";
import { toHtml, toPlainText } from "./lib/export";
import {
  captureFocus,
  focusEditorSurface,
  type FocusRestore,
} from "./lib/focus-restore";
import { applyZoom, clampZoom, ZOOM_DEFAULT, zoomIn, zoomOut } from "./lib/zoom";
import { connectSync, decideSyncAction } from "./lib/ws";
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

/**
 * The save API used from unload-time flushes. `keepalive` lets the request
 * outlive the document; without it the browser cancels the PUT and the last
 * edit is lost with no error anywhere.
 */
const unloadApi: SaveApi = {
  update: (id, content, mtime) =>
    api.update(id, content, mtime, { keepalive: true }),
  read: api.read,
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bootNote(deeplinkId: string | null): Promise<Note> {
  bootPromise ??= (async () => {
    if (deeplinkId) {
      try {
        return await api.read(deeplinkId);
      } catch {
        // Dead deeplink (note deleted/renamed) — fall through to the normal
        // boot; App toasts the miss when the booted id differs.
      }
    }
    const metas = await api.list(); // newest first
    return metas.length > 0 ? api.read(metas[0].id) : api.create("");
  })();
  return bootPromise;
}

type OverlayId = "switcher" | "action-panel" | "find";

const inTauri = "__TAURI_INTERNALS__" in window;

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
  // Panel-only toggles (step 09) — session state read from the OS on boot.
  const [screenShareVisible, setScreenShareVisible] = useState(true);
  const [loginItem, setLoginItem] = useState(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  /** The div Editor mounts into — the overlay focus fallback aims here. */
  const editorHostRef = useRef<HTMLDivElement>(null);
  // Also in state: FormatBar mounts with the editor, and a ref set during
  // Editor's onCreate would never trigger the render that shows the bar.
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(
    null,
  );

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
  /** Unsaved edits exist (auto-save pending or in flight) — sync policy input. */
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  /**
   * The edit waiting on the auto-save debounce, tagged with the note it was
   * typed into. Keyed by id (not by a note snapshot) so a flush always PUTs
   * the text under the right note while still using the freshest mtime.
   */
  const pendingSave = useRef<{
    id: string;
    markdown: string;
    mtime: number;
  } | null>(null);
  /** True once a save failure put its message in the banner, so the next
   * successful save knows the banner is its to clear. */
  const saveErrorShown = useRef(false);
  /** False until the sidecar has actually been read from disk. Persisting
   * before that writes empty defaults over the real pins/order/zoom. */
  const sidecarLoaded = useRef(false);

  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  /** Absolute .md path to the clipboard — the title bar's click gesture. */
  const copyPath = useCallback(
    (path: string) => {
      navigator.clipboard
        .writeText(path)
        .then(() => showToast("file path copied"))
        .catch((error: unknown) => showToast(`copy failed: ${error}`));
    },
    [showToast],
  );

  // ------------------------------------------------------------- overlays
  // The pure stack in app-keymap owns Esc layering; React state only mirrors
  // which overlays are visible.
  const overlayStack = useRef<readonly OverlayEntry[]>([]);
  /** Where focus was when each overlay opened (a11y H1) — replayed on close. */
  const focusRestores = useRef(new Map<OverlayId, FocusRestore>());

  /**
   * Take an overlay off screen and hand the keyboard back. The stack entry is
   * removed by the caller (Esc goes through closeTopOverlay, which pops first).
   */
  const hideOverlay = useCallback((id: OverlayId) => {
    setOverlays((open) => open.filter((o) => o !== id));
    const restore = focusRestores.current.get(id);
    focusRestores.current.delete(id);
    if (!restore) return;
    // A frame later, not now: closing can remount the very thing focus belongs
    // to (⌘P picking a different note remounts Editor under a new key), and
    // focusing a node React is about to throw away lands us back on BODY.
    requestAnimationFrame(() => {
      // Closing can also chain straight into another overlay (⌘K → "Browse
      // Notes"): that one focused its own input and owns the restore now.
      if (overlayStack.current.length === 0) restore();
    });
  }, []);

  const closeOverlay = useCallback(
    (id: OverlayId) => {
      overlayStack.current = removeOverlay(overlayStack.current, id);
      hideOverlay(id);
    },
    [hideOverlay],
  );

  const openOverlay = useCallback(
    (id: OverlayId) => {
      // Guarded: re-opening an already-open overlay (⌘F while Find is up) must
      // not overwrite the capture with the overlay's own input.
      if (!focusRestores.current.has(id)) {
        focusRestores.current.set(
          id,
          captureFocus(() => focusEditorSurface(editorHostRef.current)),
        );
      }
      overlayStack.current = pushOverlay(overlayStack.current, {
        id,
        close: () => hideOverlay(id),
      });
      setOverlays((open) => (open.includes(id) ? open : [...open, id]));
    },
    [hideOverlay],
  );

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

  /**
   * A failed save is not a passing status message: the note on disk no longer
   * matches what the user is looking at. It gets the persistent banner, not a
   * 3-second toast, and stays there until a save actually succeeds.
   */
  const reportSaveFailure = useCallback((message: string) => {
    saveErrorShown.current = true;
    setBanner(message);
  }, []);

  const clearSaveFailure = useCallback(() => {
    if (!saveErrorShown.current) return;
    saveErrorShown.current = false;
    setBanner(null);
  }, []);

  const flushSave = useCallback(
    async (id: string, markdown: string, mtime: number, saveApi?: SaveApi) => {
      try {
        const outcome = await saveWithConflictReload(
          id,
          markdown,
          mtime,
          saveApi,
        );
        if (outcome.kind === "saved") {
          clearSaveFailure();
          // Merge mtime/title only — the user may have typed since the PUT.
          setNote((n) =>
            n && n.id === outcome.note.id
              ? { ...n, mtime: outcome.note.mtime, title: outcome.note.title }
              : n,
          );
          // Clean only if nothing was typed while the PUT was in flight.
          if (noteRef.current?.id === id && noteRef.current.content === markdown) {
            dirtyRef.current = false;
          }
          return;
        }
        // 409: the file changed on disk under us and the disk version wins
        // (autosave.ts). Applied wholesale that discards whatever the user
        // typed, so park their text in its own note BEFORE swapping disk in.
        if (outcome.note.content === markdown) {
          dirtyRef.current = false;
          setNote(outcome.note);
          showToast("reloaded, changed on disk");
          return;
        }
        let copy: Note;
        try {
          copy = await api.create(markdown);
        } catch (error) {
          // Nothing is swapped in: the editor is now holding the only copy of
          // this text, which is the safest place to leave it.
          reportSaveFailure(
            `“${outcome.note.title}” changed on disk and your version could not be saved (${describe(error)}). Copy your text out before closing FloatNotes.`,
          );
          return;
        }
        dirtyRef.current = false;
        setNote(outcome.note);
        reportSaveFailure(
          `“${outcome.note.title}” changed on disk. Your unsaved version was kept at ${copy.path}`,
        );
      } catch (error) {
        reportSaveFailure(`save failed: ${describe(error)}`);
      }
    },
    [clearSaveFailure, reportSaveFailure, showToast],
  );

  /**
   * Write the debounced edit now, against the note it was typed into. The
   * entry is taken before the save starts, so two flushes racing (a note
   * switch and a pagehide in the same tick) can never PUT it twice.
   */
  const flushPending = useCallback(
    (saveApi?: SaveApi) => {
      window.clearTimeout(saveTimer.current);
      const pending = pendingSave.current;
      if (!pending) return;
      pendingSave.current = null;
      // Freshest known mtime for that note beats the one captured at
      // keystroke time, which may be a save older than the one in flight.
      const open = noteRef.current;
      const mtime = open?.id === pending.id ? open.mtime : pending.mtime;
      void flushSave(pending.id, pending.markdown, mtime, saveApi);
    },
    [flushSave],
  );

  const onEdit = useCallback(
    (markdown: string) => {
      const open = noteRef.current;
      if (!open) return;
      dirtyRef.current = true;
      pendingSave.current = { id: open.id, markdown, mtime: open.mtime };
      setNote((n) => (n ? { ...n, content: markdown } : n));
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => flushPending(), AUTOSAVE_MS);
    },
    [flushPending],
  );

  /**
   * The debounce is the app's one window for losing writing: a hidden tab, a
   * closed window or a quit inside AUTOSAVE_MS drops the last edit with no
   * error anywhere. Flush on every lifecycle signal the surface gives us.
   */
  useEffect(() => {
    const flushNow = () => flushPending(unloadApi);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", flushNow);
    window.addEventListener("blur", flushNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", flushNow);
      window.removeEventListener("blur", flushNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushPending]);

  // ------------------------------------------------------------ note flow
  /** Open a note; `record` visits it in ⌘[/⌘] history (default true). */
  const openNote = useCallback(
    (next: Note, record = true) => {
      // Switching notes used to DROP the pending auto-save of the old note,
      // so every edit typed in the last AUTOSAVE_MS before a ⌘P switch was
      // lost without a word. The pending entry carries its own note id, so it
      // can simply be flushed against that id instead.
      if (noteRef.current?.id !== next.id) {
        flushPending();
        dirtyRef.current = false;
      }
      setNote(next);
      if (record) historyRef.current = visit(historyRef.current, next.id);
    },
    [flushPending],
  );

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

  // Boot: ?note=<id> deeplink when present, else most-recent note, else the
  // empty "Untitled" note (ADR 0002).
  useEffect(() => {
    let cancelled = false;
    const requested = new URLSearchParams(window.location.search).get("note");
    bootNote(requested)
      .then((booted) => {
        if (cancelled) return;
        openNote(booted);
        if (requested && booted.id !== requested) {
          showToast("note not found — opened most recent");
        }
      })
      .catch((error: unknown) => {
        // Visible failure over a silently empty panel.
        if (!cancelled) setBanner(`FloatNotes could not load notes: ${error}`);
      });
    api
      .sidecarLoad()
      .then((loaded) => {
        if (cancelled) return;
        sidecarLoaded.current = true;
        setSidecar(loaded);
        applyZoom(loaded.zoom);
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(`could not load pins: ${error}`);
      });
    return () => {
      cancelled = true;
    };
  }, [openNote, showToast]);

  // OS-backed toggle state (step 09) — panel only; the plain browser surface
  // has no window to hide or login item to manage.
  useEffect(() => {
    if (!inTauri) return;
    invoke<boolean>("get_screen_share_visible")
      .then(setScreenShareVisible)
      .catch((error: unknown) => showToast(`screen-share state: ${error}`));
    invoke<boolean>("get_login_item")
      .then(setLoginItem)
      .catch((error: unknown) => showToast(`login-item state: ${error}`));
  }, [showToast]);

  // --------------------------------------------------------------- pins
  const persistSidecar = useCallback(
    (next: Sidecar) => {
      // The sidecar is a whole-value PUT, so writing it before the load
      // succeeded overwrites the real pins/order/zoom on disk with the empty
      // defaults this component starts with. Refuse, visibly, instead.
      if (!sidecarLoaded.current) {
        showToast("pins unavailable, not saved");
        return;
      }
      setSidecar(next);
      api.sidecarSave(next).catch((error: unknown) => {
        showToast(`could not save pins: ${error}`);
      });
    },
    [showToast],
  );

  // ---------------------------------------------------------------- zoom
  /** Apply + persist; `null` stored for the default keeps old sidecars tidy. */
  const setZoom = useCallback(
    (next: number) => {
      applyZoom(next);
      persistSidecar({
        ...sidecarRef.current,
        zoom: next === ZOOM_DEFAULT ? null : next,
      });
    },
    [persistSidecar],
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

  /** Swap in the most recent surviving note (or a fresh "Untitled"). */
  const openMostRecentSurvivor = useCallback(async () => {
    try {
      const metas = await api.list();
      openNote(
        metas.length > 0 ? await api.read(metas[0].id) : await api.create(""),
      );
    } catch (error) {
      setBanner(`FloatNotes could not load notes: ${error}`);
    }
  }, [openNote]);

  // ------------------------------------------------------ delete + undo
  /**
   * Ids WE deleted, so the sync channel's echo of our own DELETE doesn't
   * double-handle it (deleteWithUndo already swapped notes) or toast
   * "deleted elsewhere" for a local action.
   */
  const locallyDeleted = useRef(new Set<string>());
  const undoTimer = useRef<number | undefined>(undefined);
  const deleteWithUndo = useCallback(
    async (target: Note) => {
      // Mark BEFORE the DELETE: the server broadcasts before it responds, so
      // the ws echo can beat the HTTP response.
      locallyDeleted.current.add(target.id);
      try {
        await api.remove(target.id);
      } catch (error) {
        locallyDeleted.current.delete(target.id);
        showToast(`delete failed: ${error}`);
        return;
      }
      historyRef.current = purge(historyRef.current, target.id);
      // Deleting the visible note swaps in the most recent survivor.
      if (noteRef.current?.id === target.id) {
        await openMostRecentSurvivor();
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
    [openNote, openMostRecentSurvivor, showToast],
  );

  // ---------------------------------------------------------- live sync
  // One socket per mounted app; events → pure decision table (ws.ts).
  // NO polling — this channel plus the auto-save 409 path IS the sync story.
  useEffect(() => {
    const socket = connectSync((event) => {
      // Echo of our own DELETE — deleteWithUndo already handled the swap.
      if (event.type === "note-deleted" && locallyDeleted.current.delete(event.id)) {
        return;
      }
      const openNow = noteRef.current;
      const action = decideSyncAction(
        event,
        openNow
          ? { id: openNow.id, mtime: openNow.mtime, dirty: dirtyRef.current }
          : null,
      );
      switch (action.kind) {
        case "ignore":
          break;
        case "reload":
          // Silent reload — same note id, so the Editor stays mounted and
          // its caret guard applies only genuinely different content.
          api
            .read(action.id)
            .then((fresh) => {
              setNote((n) =>
                // Still the same note and still clean — a switch or a
                // keystroke during the fetch wins over the reload (the
                // 409 path resolves the dirty case instead).
                n && n.id === fresh.id && !dirtyRef.current ? fresh : n,
              );
            })
            .catch((error: unknown) => {
              showToast(`could not reload note: ${error}`);
            });
          break;
        case "open-most-recent":
          showToast("note deleted elsewhere");
          historyRef.current = purge(historyRef.current, event.id);
          void openMostRecentSurvivor();
          break;
      }
    });
    return () => socket.close();
  }, [openMostRecentSurvivor, showToast]);

  // ------------------------------------------------------ ?note= deeplink
  // Keep the address bar shareable: the URL always names the open note.
  useEffect(() => {
    if (!note?.id) return;
    window.history.replaceState(
      null,
      "",
      `?note=${encodeURIComponent(note.id)}`,
    );
  }, [note?.id]);

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
        case "zoom-in":
          setZoom(zoomIn(clampZoom(sidecarRef.current.zoom ?? ZOOM_DEFAULT)));
          break;
        case "zoom-out":
          setZoom(zoomOut(clampZoom(sidecarRef.current.zoom ?? ZOOM_DEFAULT)));
          break;
        case "zoom-reset":
          setZoom(ZOOM_DEFAULT);
          break;
        case "dismiss-panel":
          // Esc with no overlays — the sidecar setting decides (step 09).
          if (sidecarRef.current.escBehavior === "unfocus") {
            unfocusPanel();
          } else {
            hidePanel();
          }
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
    [newNote, toggleOverlay, togglePin, openNoteById, openOverlay, setZoom],
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
      id: "copy-plain",
      label: "Copy as Plain Text",
      run: () => {
        const editor = editorRef.current;
        if (!editor) return;
        navigator.clipboard
          .writeText(toPlainText(editor))
          .then(() => showToast("plain text copied"))
          .catch((error: unknown) => showToast(`copy failed: ${error}`));
      },
    },
    {
      id: "copy-html",
      label: "Copy as HTML",
      run: () => {
        const editor = editorRef.current;
        if (!editor) return;
        navigator.clipboard
          .writeText(toHtml(editor))
          .then(() => showToast("HTML copied"))
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
    // Panel-only actions (step 09) — meaningless in the plain browser surface.
    ...(inTauri
      ? ([
          {
            id: "screen-share",
            label: screenShareVisible
              ? "Hide from Screen Share"
              : "Show in Screen Share",
            run: () => {
              const next = !screenShareVisible;
              invoke("set_screen_share_visible", { visible: next })
                .then(() => {
                  setScreenShareVisible(next);
                  showToast(
                    next ? "visible in screen share" : "hidden from screen share",
                  );
                })
                .catch((error: unknown) =>
                  showToast(`screen share toggle failed: ${error}`),
                );
            },
          },
          {
            id: "login-item",
            label: loginItem
              ? "Disable Launch at Login"
              : "Enable Launch at Login",
            run: () => {
              const next = !loginItem;
              invoke("set_login_item", { enabled: next })
                .then(() => {
                  setLoginItem(next);
                  showToast(
                    next ? "will launch at login" : "removed from login items",
                  );
                })
                .catch((error: unknown) =>
                  showToast(`login item failed: ${error}`),
                );
            },
          },
          {
            id: "esc-behavior",
            label:
              sidecar.escBehavior === "unfocus"
                ? "Esc: Unfocus (switch to Hide)"
                : "Esc: Hide (switch to Unfocus)",
            run: () => {
              const prev = sidecarRef.current;
              const next =
                prev.escBehavior === "unfocus" ? "hide" : "unfocus";
              persistSidecar({ ...prev, escBehavior: next });
              showToast(
                next === "unfocus"
                  ? "Esc now unfocuses the panel"
                  : "Esc now hides the panel",
              );
            },
          },
        ] satisfies Action[])
      : []),
  ];

  return (
    <div className="relative flex h-screen flex-col overflow-hidden rounded-xl bg-white">
      <TitleBar
        title={note?.title ?? "FloatNotes"}
        onCopyPath={note ? () => copyPath(note.path) : undefined}
      />
      {banner && (
        <div className="shrink-0 bg-red-700 px-3 py-2 text-xs text-white">
          {banner}
        </div>
      )}
      <div
        ref={editorHostRef}
        className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3"
      >
        {note && (
          <Editor
            key={note.id}
            value={note.content}
            onChange={onEdit}
            onReady={(editor) => {
              editorRef.current = editor;
              setEditorInstance(editor);
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
      {/*
        `flex-wrap` is load-bearing: the app root is `overflow-hidden`, so a bar
        that overflows loses controls silently (no scrollbar, no affordance).
        Wrapping trades height — which the window has — for width it doesn't.
      */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-200 px-2 py-1">
        {editorInstance ? <FormatBar editor={editorInstance} /> : <span />}
        {/* `ml-auto` keeps the count on the right edge on its own wrapped row,
            where `justify-between` would otherwise flush it left. */}
        <div className="ml-auto">
          <StatusBar markdown={note?.content ?? ""} />
        </div>
      </div>
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
              className="font-semibold text-blue-300 hover:text-blue-200 focus-visible:text-blue-200"
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
