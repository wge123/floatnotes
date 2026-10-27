import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import type { NoteMeta } from "./api";

/**
 * The note a `[[target]]` names. A note's id is its path under the notes dir
 * without `.md` (ADR 0016), so the target is compared case-insensitively with
 * each note's id (the relative path, extensionless) and with its basename.
 * Alias (`|…`), heading (`#…`) and block (`^…`) parts are dropped, and a
 * trailing `.md` is ignored. Several notes can share a basename, so the answer
 * is a list: none, one to open, or several to choose from.
 */
export function resolveWikilink(target: string, notes: readonly NoteMeta[]): NoteMeta[] {
  const wanted = target
    .split("|")[0]
    .split(/[#^]/)[0]
    .trim()
    .replace(/\.md$/i, "")
    .toLowerCase();
  if (!wanted) return [];
  return notes.filter((n) => {
    const id = n.id.toLowerCase();
    return id === wanted || id.slice(id.lastIndexOf("/") + 1) === wanted;
  });
}

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/** The `[[…]]` runs in one text node, as doc-relative ranges plus their target. */
function wikilinkRanges(doc: PMNode): Array<{ from: number; to: number; target: string }> {
  const out: Array<{ from: number; to: number; target: string }> = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    // Code is literal: a `[[x]]` inside it is not a link.
    if (parent?.type.name === "codeBlock" || node.marks.some((m) => m.type.name === "code")) return;
    for (const m of node.text.matchAll(WIKILINK)) {
      const from = pos + m.index;
      out.push({ from, to: from + m[0].length, target: m[1] });
    }
  });
  return out;
}

export interface WikilinkOptions {
  /** Called with the target text when a wikilink is Cmd/Ctrl-clicked. */
  onOpen: ((target: string) => void) | null;
}

/**
 * Wikilinks look like links and open on Cmd/Ctrl-click, like external links. The
 * styling is a decoration, never a mark or node, so the document and the saved
 * markdown are untouched (ADR 0017). The target rides on the span as
 * `data-wikilink`, so the click handler reads the DOM, not document positions.
 */
export const Wikilink = Extension.create<WikilinkOptions>({
  name: "floatnotesWikilink",

  addOptions() {
    return { onOpen: null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const ranges = wikilinkRanges(state.doc);
            if (ranges.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              ranges.map((r) =>
                Decoration.inline(r.from, r.to, { class: "wikilink", "data-wikilink": r.target }),
              ),
            );
          },
          handleDOMEvents: {
            click: (_view, event) => {
              if (!(event.metaKey || event.ctrlKey)) return false;
              const span = (event.target as HTMLElement | null)?.closest("[data-wikilink]");
              const target = span?.getAttribute("data-wikilink");
              if (!target || !options.onOpen) return false;
              event.preventDefault();
              options.onOpen(target);
              return true;
            },
          },
        },
      }),
    ];
  },
});
