import { Extension, type CommandProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchTerm: (term: string) => ReturnType;
      resetIndex: () => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
    };
  }
}

export interface SearchMatch {
  from: number;
  to: number;
}

interface SearchState {
  term: string;
  matches: SearchMatch[];
  index: number;
  decorations: DecorationSet;
}

type SearchMeta = { term: string } | { index: number };

const key = new PluginKey<SearchState>("floatnotesSearch");

const EMPTY: SearchState = {
  term: "",
  matches: [],
  index: 0,
  decorations: DecorationSet.empty,
};

/**
 * Literal, case-insensitive matches per textblock. Text split across marks is
 * matched as one run; non-text inline leaves (hard breaks, images) occupy one
 * placeholder char so string offsets map 1:1 to document positions.
 */
function findMatches(doc: ProseMirrorNode, term: string): SearchMatch[] {
  if (!term) return [];
  const needle = term.toLowerCase();
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child) => {
      text += child.isText ? child.text! : "￼";
    });
    text = text.toLowerCase();
    const start = pos + 1;
    for (
      let i = text.indexOf(needle);
      i !== -1;
      i = text.indexOf(needle, i + needle.length)
    ) {
      matches.push({ from: start + i, to: start + i + needle.length });
    }
    return false;
  });
  return matches;
}

function build(
  doc: ProseMirrorNode,
  term: string,
  index: number,
): SearchState {
  const matches = findMatches(doc, term);
  const current = matches.length === 0 ? 0 : Math.min(index, matches.length - 1);
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class:
          i === current ? "search-result search-result-current" : "search-result",
      }),
    ),
  );
  return { term, matches, index: current, decorations };
}

export const Search = Extension.create({
  name: "search",

  addStorage() {
    // Mirrors plugin state after every view update (see the plugin's view).
    return { results: [] as SearchMatch[], resultIndex: 0 };
  },

  addCommands() {
    const step = (delta: 1 | -1) => () =>
      ({ state, dispatch, view }: CommandProps) => {
        const s = key.getState(state);
        if (!s || s.matches.length === 0) return false;
        const n = s.matches.length;
        const index = (s.index + delta + n) % n;
        if (dispatch) {
          dispatch(state.tr.setMeta(key, { index } satisfies SearchMeta));
          scrollToCurrent(view);
        }
        return true;
      };
    return {
      setSearchTerm:
        (term: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { term } satisfies SearchMeta));
          return true;
        },
      resetIndex:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { index: 0 } satisfies SearchMeta));
          return true;
        },
      nextSearchResult: step(1),
      previousSearchResult: step(-1),
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const sync = (view: EditorView) => {
      const s = key.getState(view.state);
      storage.results = s?.matches ?? [];
      storage.resultIndex = s?.index ?? 0;
    };
    return [
      new Plugin<SearchState>({
        key,
        state: {
          init: () => EMPTY,
          apply(tr, prev, _old, newState) {
            const meta = tr.getMeta(key) as SearchMeta | undefined;
            if (meta && "term" in meta) {
              return build(newState.doc, meta.term, 0);
            }
            if (meta) return build(newState.doc, prev.term, meta.index);
            if (tr.docChanged && prev.term) {
              return build(newState.doc, prev.term, prev.index);
            }
            return prev;
          },
        },
        view: (view) => {
          sync(view);
          return { update: sync };
        },
        props: {
          decorations: (state) =>
            key.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

function scrollToCurrent(view: EditorView) {
  // scrollIntoView is absent in jsdom.
  view.dom.querySelector(".search-result-current")?.scrollIntoView?.({
    block: "nearest",
  });
}
