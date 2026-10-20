import type { NoteMeta } from "./api";

/**
 * Folder model behind the Explorer. A folder is a `/`-separated path under the
 * notes directory (`""` is the top level). There is no folder list from the
 * server: folders exist exactly where a note lives at or below them (ADR 0016).
 */

export type ExplorerEntry =
  | { kind: "folder"; key: string; path: string; name: string }
  | { kind: "note"; key: string; note: NoteMeta };

export interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

export const folderKey = (path: string) => `d:${path}`;
export const noteKey = (id: string) => `n:${id}`;

export const folderOfId = (id: string) =>
  id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";

export const parentFolder = (path: string) => folderOfId(path);

export const baseName = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1);

/** `"a/b"` → `["a", "a/b"]`; the top level has no ancestors. */
export function pathChain(path: string): string[] {
  if (path === "") return [];
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

/** The folders tree, derived from where notes live. Root has path `""`. */
export function buildFolderTree(notes: readonly NoteMeta[]): FolderNode {
  const root: FolderNode = { path: "", name: "", children: [] };
  const byPath = new Map<string, FolderNode>([["", root]]);
  for (const note of notes) {
    for (const path of pathChain(note.folder)) {
      if (byPath.has(path)) continue;
      const node: FolderNode = { path, name: baseName(path), children: [] };
      byPath.set(path, node);
      byPath.get(parentFolder(path))!.children.push(node);
    }
  }
  for (const node of byPath.values()) node.children.sort(byName);
  return root;
}

/** One folder's contents: sub-folders (by name), then notes by mtime desc. */
export function listFolder(
  notes: readonly NoteMeta[],
  folder: string,
): ExplorerEntry[] {
  const subfolders = new Map<string, string>();
  const here: NoteMeta[] = [];
  for (const note of notes) {
    if (note.folder === folder) {
      here.push(note);
      continue;
    }
    const inside = folder === "" || note.folder.startsWith(`${folder}/`);
    if (!inside) continue;
    const rest = folder === "" ? note.folder : note.folder.slice(folder.length + 1);
    const name = rest.split("/")[0];
    subfolders.set(name, folder === "" ? name : `${folder}/${name}`);
  }
  return [
    ...[...subfolders]
      .map(([name, path]) => ({ kind: "folder" as const, key: folderKey(path), path, name }))
      .sort(byName),
    ...here
      .sort((a, b) => b.mtime - a.mtime)
      .map((note) => ({ kind: "note" as const, key: noteKey(note.id), note })),
  ];
}

/**
 * Narrow a folder's entries by a typed filter: a case-insensitive match on a
 * note's title or filename, or a folder's name. Empty filter keeps everything.
 */
export function filterEntries(
  entries: readonly ExplorerEntry[],
  filter: string,
): ExplorerEntry[] {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return [...entries];
  return entries.filter((e) =>
    e.kind === "folder"
      ? e.name.toLowerCase().includes(needle)
      : e.note.title.toLowerCase().includes(needle) ||
        `${baseName(e.note.id)}.md`.toLowerCase().includes(needle),
  );
}

/** Folder navigation history (Finder-style back / forward). */
export interface FolderHistory {
  stack: readonly string[];
  at: number;
}

export const startHistory = (folder: string): FolderHistory => ({
  stack: [folder],
  at: 0,
});

export const currentFolder = (h: FolderHistory) => h.stack[h.at];

/** Visiting a new folder drops the forward branch; revisiting "here" is a no-op. */
export function visitFolder(h: FolderHistory, folder: string): FolderHistory {
  if (folder === currentFolder(h)) return h;
  return { stack: [...h.stack.slice(0, h.at + 1), folder], at: h.at + 1 };
}

export const canGoBack = (h: FolderHistory) => h.at > 0;
export const canGoForward = (h: FolderHistory) => h.at < h.stack.length - 1;

export const goBack = (h: FolderHistory): FolderHistory =>
  canGoBack(h) ? { ...h, at: h.at - 1 } : h;

export const goForward = (h: FolderHistory): FolderHistory =>
  canGoForward(h) ? { ...h, at: h.at + 1 } : h;
