import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Obsidian-style reveal-on-caret: the raw markdown markers for whatever the
 * caret is sitting inside come back into view, so `**bold**` reads as
 * `**bold**` while you are editing it and as **bold** once you leave.
 *
 * ADR 0005 shipped v1 with markers consumed and tracked this as post-v1. It is
 * an editor-only change by construction: the markers are DECORATIONS, never
 * document content, so `getMarkdown()` is byte-identical whether or not the
 * caret is inside styled text. Nothing here can reach the file on disk.
 *
 * The marker strings are the ones the serializer emits, not a second opinion
 * about markdown: `bulletListMarker: "-"` and tiptap-markdown's defaults in
 * editor-extensions.ts are what a save actually writes, so revealing anything
 * else would teach the wrong syntax.
 */
const MARK_MARKERS: Record<string, string> = {
  bold: "**",
  italic: "*",
  code: "`",
  strike: "~~",
};

export interface MarkerSpec {
  /** Document position the marker text is drawn at. */
  pos: number;
  /** The raw markdown the user would have typed. */
  text: string;
  /** Which side of the styled range this is, for stable ordering at one pos. */
  side: "open" | "close";
}

/**
 * The extent of `markName` around `pos` inside its own text block.
 *
 * Walks outward child by child rather than scanning the whole document: a mark
 * range cannot cross a text block, so the parent is the only region that can
 * contain it, and stopping there keeps this linear in the paragraph rather than
 * in the note.
 */
function markRange(
  state: EditorState,
  pos: number,
  markName: string,
): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  // Collect every contiguous run of the mark in this block, then pick the one
  // holding the caret. Contiguity is the point: two separately-bolded words in
  // one paragraph are two runs, and treating them as one would draw markers
  // around the plain text between them. Adjacent text nodes carrying the same
  // mark (a link boundary splits them, for instance) merge back into one run.
  const runs: Array<{ from: number; to: number }> = [];
  let offset = $pos.start();

  parent.forEach((child) => {
    const childFrom = offset;
    const childTo = offset + child.nodeSize;
    offset = childTo;
    if (!child.isText) return;
    if (!child.marks.some((m) => m.type.name === markName)) return;
    const last = runs[runs.length - 1];
    if (last && last.to === childFrom) last.to = childTo;
    else runs.push({ from: childFrom, to: childTo });
  });

  // Both edges count as inside, which is what makes arrowing INTO styled text
  // reveal it rather than requiring a position strictly within.
  return runs.find((r) => pos >= r.from && pos <= r.to) ?? null;
}

/**
 * Every marker the current selection should reveal, as pure data.
 *
 * Kept separate from the plugin so the behaviour is testable against a headless
 * editor with no view: a decoration is invisible to assertions, a MarkerSpec is
 * not.
 */
export function markerSpecs(state: EditorState): MarkerSpec[] {
  const { selection } = state;
  // Reveal for a collapsed caret only. Across a selection the user is acting on
  // a span rather than editing inside one, and injecting widgets mid-selection
  // makes the highlight read as though it covers characters that are not there.
  if (!selection.empty) return [];

  const pos = selection.from;
  const $pos = state.doc.resolve(pos);
  const specs: MarkerSpec[] = [];

  const parent = $pos.parent;
  if (parent.type.name === "heading") {
    const level = (parent.attrs.level as number) ?? 1;
    specs.push({ pos: $pos.start(), text: `${"#".repeat(level)} `, side: "open" });
  }

  // storedMarks is what a mark toggle sets before any character is typed; marks()
  // is what the character to the left carries. Checking both is what makes
  // Cmd-B-then-reveal behave the same as arrowing into existing bold text.
  const active = state.storedMarks ?? $pos.marks();
  for (const mark of active) {
    const marker = MARK_MARKERS[mark.type.name];
    if (!marker) continue;
    const range = markRange(state, pos, mark.type.name);
    if (!range) continue;
    specs.push({ pos: range.from, text: marker, side: "open" });
    specs.push({ pos: range.to, text: marker, side: "close" });
  }

  return specs;
}

function widget(spec: MarkerSpec): Decoration {
  return Decoration.widget(
    spec.pos,
    () => {
      const el = document.createElement("span");
      el.className = "reveal-marker";
      el.textContent = spec.text;
      // The marker is scenery, not text: it must not be selectable, must not be
      // copied, and must never be walked into by the caret, or arrowing through
      // a bold word would stall on characters the document does not contain.
      el.setAttribute("contenteditable", "false");
      el.setAttribute("aria-hidden", "true");
      return el;
    },
    // side < 0 draws the opener before the styled text, > 0 the closer after,
    // so both sit outside the run instead of inside its first character.
    { side: spec.side === "open" ? -1 : 1, ignoreSelection: true },
  );
}

export const RevealMarkers = Extension.create({
  name: "revealMarkers",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const specs = markerSpecs(state);
            if (specs.length === 0) return DecorationSet.empty;
            return DecorationSet.create(state.doc, specs.map(widget));
          },
        },
      }),
    ];
  },
});
