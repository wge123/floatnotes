import { useEffect, useMemo, useRef, useState } from "react";

import type { NoteMeta } from "../lib/api";
import {
  baseName,
  buildFolderTree,
  canGoBack,
  canGoForward,
  currentFolder,
  folderKey,
  folderOfId,
  goBack,
  goForward,
  listFolder,
  noteKey,
  parentFolder,
  pathChain,
  startHistory,
  visitFolder,
  type ExplorerEntry,
  type FolderHistory,
  type FolderNode,
} from "../lib/explorer-model";
import { trapTab } from "../lib/focus-trap";

export interface ExplorerProps {
  /** `null` while the list is loading. */
  notes: readonly NoteMeta[] | null;
  currentNoteId: string | null;
  /** Called with the note id; the Explorer closes itself right before. */
  onOpen: (id: string) => void;
  onClose: () => void;
}

/** Column count of the tile grid, read from the laid-out CSS grid. */
function columnCount(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(/\s+/);
  return Math.max(tracks.filter((t) => t !== "" && t !== "none").length, 1);
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 64 52" className="h-full w-full" aria-hidden="true">
      <path d="M2 8a4 4 0 0 1 4-4h18l6 6h28a4 4 0 0 1 4 4v4H2z" fill="#60a5fa" />
      <rect x="2" y={open ? 16 : 14} width="60" height="34" rx="4" fill="#93c5fd" />
    </svg>
  );
}

/** A page with a folded corner and a thumbnail of the note's opening lines. */
function PageIcon({ snippet }: { snippet: string }) {
  return (
    <div className="relative h-full w-[78%] overflow-hidden border border-gray-300 bg-white p-1 [clip-path:polygon(0_0,78%_0,100%_16%,100%_100%,0_100%)]">
      <div className="absolute right-0 top-0 h-[16%] w-[22%] bg-gray-200" />
      <p className="whitespace-pre-wrap break-words text-[4.5px] leading-[1.25] text-gray-500">
        {snippet}
      </p>
    </div>
  );
}

/**
 * ⌘O Explorer: a Finder-style window over the notes' folder structure.
 *
 * Owns its navigation state (current folder, history, selection, sidebar
 * expansion); the note list comes from the caller. Esc and the focus restore
 * are the app overlay stack's job, like every other overlay.
 *
 * Extension points for the view mode and filter (ticket 05): the toolbar's
 * trailing slot, and `renderTile`, which is the only place a tile is drawn.
 */
export default function Explorer({
  notes,
  currentNoteId,
  onOpen,
  onClose,
}: ExplorerProps) {
  const list = useMemo(() => notes ?? [], [notes]);
  const [history, setHistory] = useState<FolderHistory>(() =>
    startHistory(currentNoteId ? folderOfId(currentNoteId) : ""),
  );
  const [selected, setSelected] = useState<string | null>(
    currentNoteId ? noteKey(currentNoteId) : null,
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set(["", ...pathChain(currentNoteId ? folderOfId(currentNoteId) : "")]),
  );
  const gridRef = useRef<HTMLDivElement>(null);

  const folder = currentFolder(history);
  const tree = useMemo(() => buildFolderTree(list), [list]);
  const entries = useMemo(() => listFolder(list, folder), [list, folder]);
  const selIndex = entries.findIndex((e) => e.key === selected);
  const selectedEntry = selIndex >= 0 ? entries[selIndex] : null;

  useEffect(() => gridRef.current?.focus(), []);

  useEffect(() => {
    if (selIndex < 0) return;
    gridRef.current
      ?.querySelector(`#explorer-tile-${selIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selIndex]);

  const expand = (path: string) =>
    setExpanded((s) => new Set([...s, "", ...pathChain(path)]));

  /** Show `path`, as a new history stop; `select` picks the tile to land on. */
  const navigate = (path: string, select: string | null = null) => {
    setHistory((h) => visitFolder(h, path));
    expand(path);
    setSelected(select);
    gridRef.current?.focus();
  };
  const moveHistory = (to: (h: FolderHistory) => FolderHistory) => {
    const next = to(history);
    if (next === history) return;
    setHistory(next);
    expand(currentFolder(next));
    setSelected(null);
    gridRef.current?.focus();
  };
  const up = () => {
    if (folder === "") return;
    navigate(parentFolder(folder), folderKey(folder));
  };
  const openNote = (id: string) => {
    onClose();
    onOpen(id);
  };
  const activate = (entry: ExplorerEntry) =>
    entry.kind === "folder" ? navigate(entry.path) : openNote(entry.note.id);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    trapTab(event);
    if (event.defaultPrevented) return;
    const handled = () => {
      event.preventDefault();
      return true;
    };

    if (event.metaKey) {
      // ⌘1–9 (pinned jump) and ⌘N are deliberately not here: the app keymap owns them.
      if (event.shiftKey || event.altKey || event.ctrlKey) return;
      if (event.key === "ArrowUp") return void (handled() && up());
      if (event.key === "ArrowDown") {
        if (selectedEntry) handled() && activate(selectedEntry);
        return;
      }
      if (event.key === "[") return void (handled() && moveHistory(goBack));
      if (event.key === "]") return void (handled() && moveHistory(goForward));
      return;
    }

    // Plain keys act on the grid only, so Enter on a toolbar button still clicks it.
    if (event.target !== gridRef.current) return;
    const step = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columnCount(gridRef.current),
      ArrowDown: columnCount(gridRef.current),
    }[event.key];
    if (step !== undefined) {
      handled();
      if (entries.length === 0) return;
      const index =
        selIndex < 0
          ? 0
          : Math.min(Math.max(selIndex + step, 0), entries.length - 1);
      setSelected(entries[index].key);
    } else if (event.key === "Enter") {
      handled();
      if (selectedEntry) activate(selectedEntry);
    } else if (event.key === "Backspace") {
      handled();
      up();
    }
  };

  const noteFile = (note: NoteMeta) => `${note.id}.md`;

  const renderTile = (entry: ExplorerEntry, index: number) => {
    const isSelected = entry.key === selected;
    const isCurrent = entry.kind === "note" && entry.note.id === currentNoteId;
    const label = entry.kind === "folder" ? entry.name : entry.note.title;
    return (
      <div
        key={entry.key}
        id={`explorer-tile-${index}`}
        role="option"
        aria-selected={isSelected}
        title={
          entry.kind === "folder"
            ? entry.path
            : `${entry.note.title}\n${noteFile(entry.note)}`
        }
        onClick={() => setSelected(entry.key)}
        onDoubleClick={() => activate(entry)}
        className="flex flex-col items-center gap-1 rounded p-1"
      >
        <div
          className={`flex h-14 w-16 items-center justify-center rounded p-1 ${
            isSelected ? "bg-gray-200/70" : ""
          }`}
        >
          {entry.kind === "folder" ? (
            <FolderIcon />
          ) : (
            <PageIcon snippet={entry.note.snippet} />
          )}
        </div>
        <span
          data-tile-label
          className={`line-clamp-2 max-w-full break-all rounded px-1 text-center text-[10px] leading-tight ${
            isSelected
              ? "bg-blue-500 text-white"
              : isCurrent
                ? "font-medium text-blue-700"
                : "text-gray-800"
          }`}
        >
          {label}
        </span>
      </div>
    );
  };

  const renderTree = (node: FolderNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.path);
    const isCwd = node.path === folder;
    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => {
            if (!isCwd) {
              navigate(node.path);
            } else {
              setExpanded((s) => {
                const next = new Set(s);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
              gridRef.current?.focus();
            }
          }}
          style={{ paddingLeft: 6 + depth * 10 }}
          className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left ${
            isCwd ? "bg-blue-100 text-blue-900" : "text-gray-800 hover:bg-gray-100 focus-visible:bg-gray-100"
          }`}
        >
          <span className="w-2.5 text-[9px] text-gray-600" aria-hidden="true">
            {node.children.length === 0 ? "" : isOpen ? "▾" : "▸"}
          </span>
          <span className="h-3 w-3.5 shrink-0">
            <FolderIcon open={isOpen} />
          </span>
          <span className="truncate">{depth === 0 ? "Notes" : node.name}</span>
        </button>
        {isOpen && node.children.map((child) => renderTree(child, depth + 1))}
      </div>
    );
  };

  const navBtn =
    "rounded px-1.5 py-0.5 text-gray-600 enabled:hover:bg-gray-100 enabled:focus-visible:bg-gray-100 disabled:opacity-30";
  const crumbs = ["", ...pathChain(folder)];

  return (
    <div
      className="absolute inset-0 z-40 bg-black/20 px-3 py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Folder explorer"
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white text-[11px] text-gray-800 shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1">
          <button
            type="button"
            aria-label="Back"
            title="Back (⌘[)"
            className={navBtn}
            disabled={!canGoBack(history)}
            onClick={() => moveHistory(goBack)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Forward"
            title="Forward (⌘])"
            className={navBtn}
            disabled={!canGoForward(history)}
            onClick={() => moveHistory(goForward)}
          >
            ›
          </button>
          <button
            type="button"
            aria-label="Up"
            title="Enclosing folder (⌘↑)"
            className={navBtn}
            disabled={folder === ""}
            onClick={up}
          >
            ↑
          </button>
          <nav
            aria-label="Path"
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
          >
            {crumbs.map((path, i) => (
              <span key={path} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && (
                  <span className="text-gray-600" aria-hidden="true">
                    ›
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => navigate(path)}
                  className={`rounded px-1 hover:bg-gray-100 focus-visible:bg-gray-100 ${
                    i === crumbs.length - 1 ? "font-medium text-gray-900" : "text-gray-600"
                  }`}
                >
                  {i === 0 ? "Notes" : baseName(path)}
                </button>
              </span>
            ))}
          </nav>
          {/* Trailing toolbar slot: view toggle and filter land here (ticket 05). */}
        </div>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Folders"
            className="w-36 shrink-0 overflow-auto border-r border-gray-200 bg-gray-50 py-1"
          >
            {renderTree(tree, 0)}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {notes === null && (
              <p className="px-3 py-2 text-gray-600">loading…</p>
            )}
            <div
              ref={gridRef}
              role="listbox"
              tabIndex={0}
              aria-label="Folder contents"
              aria-activedescendant={
                selIndex >= 0 ? `explorer-tile-${selIndex}` : undefined
              }
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelected(null);
              }}
              className="floatnotes-focus-inset grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1 overflow-auto p-2"
            >
              {entries.map(renderTile)}
            </div>
          </div>
        </div>
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-t border-gray-200 px-2 py-0.5 text-[10px] text-gray-600"
        >
          <span>{entries.length === 1 ? "1 item" : `${entries.length} items`}</span>
          {selectedEntry && (
            <span className="truncate">
              {selectedEntry.kind === "folder"
                ? `${selectedEntry.name}/`
                : `${selectedEntry.note.title} — ${noteFile(selectedEntry.note)}`}
            </span>
          )}
          <span className="ml-auto shrink-0">⏎ open · ⌫ up · Esc close</span>
        </div>
      </div>
    </div>
  );
}
