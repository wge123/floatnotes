import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import { Underline } from "@tiptap/extension-underline";

import { NoteLink } from "./markdown-fixups";
import { callParent } from "./parent-renderer";

/**
 * Spellings a save keeps from before TipTap 3 (ADR 0019), because other tools
 * read these notes: nvim, Obsidian-style wikilinks, GitHub.
 */

/**
 * `[[Note]]` is a wikilink, plain text to this editor. marked reads the inner
 * `[Note]` as a reference link whenever the note defines `[Note]: url`, which
 * left `[` + a link + `]` on load. This tokenizer claims the whole `[[…]]`
 * first, so the lexer never gets to read it as a link, and it comes through as
 * the text it is. (On save, `cleanEscapes` then proves the brackets need no
 * backslashes, because the parse of `[[Note]]` is that same text.)
 */
export const WikiLinkText = Extension.create({
  name: "wikiLinkText",
  markdownTokenName: "wikiLinkText",
  markdownTokenizer: {
    name: "wikiLinkText",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize(src: string) {
      const raw = /^\[\[[^[\]\n]+\]\](?![(\[])/.exec(src)?.[0];
      return raw ? { type: "wikiLinkText", raw, text: raw } : undefined;
    },
  },
  parseMarkdown: (token: { text?: string }) => ({ type: "text", text: token.text ?? "" }),
});

/**
 * Underline is written `<u>…</u>`; `++…++` still parses (the stock tokenizer).
 * The text inside `<u>` is read back as raw HTML, not markdown, so an escape
 * or a nested mark there would come back as literal characters. Such a run is
 * flagged `plus` by `spellMarks` and keeps `++…++`, whose inside is markdown.
 */
export const NoteUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    const inner = helpers.renderChildren(node);
    return node.attrs?.plus ? `++${inner}++` : `<u>${inner}</u>`;
  },
});

const NEEDS_MARKDOWN = /[\\`*_[\]~<>&]/;

/** A scheme, then no whitespace or angle brackets: what `<…>` can hold. */
const ANGLE_URL = /^[a-z][a-z0-9+.-]*:[^\s<>]*$/i;

/**
 * A link whose text equals its href is written `<href>`, not `[href](href)`.
 * The mark renderer sees only a placeholder for the text between its opening
 * and closing, and the text itself would be escaped (`x\_y` inside `<…>` is
 * wrong), so `angleLinks` first turns such a run into one empty text node
 * flagged `angle`, and the renderer writes the href itself.
 */
export const SpelledLink = NoteLink.extend({
  renderMarkdown(node, helpers, context) {
    if (node.attrs?.angle) {
      return `<${node.attrs.href}${helpers.renderChildren(node)}>`;
    }
    return callParent("Link", this.parent, node, helpers, context);
  },
});

function linkOnly(n: JSONContent): JSONContent | null {
  if (n.type !== "text" || n.marks?.length !== 1) return null;
  const mark = n.marks[0];
  return mark.type === "link" && !mark.attrs?.title ? mark : null;
}

const isUnderlined = (n: JSONContent) =>
  n.type === "text" && n.marks?.some((m) => m.type === "underline");

/**
 * Serialization-time pass: flag each plain link run whose text is its href
 * (`angle`), and each underline run that `<u>` cannot hold (`plus`).
 */
export function spellMarks(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const content: JSONContent[] = [];
  const kids = node.content;
  for (let i = 0; i < kids.length; i++) {
    const mark = linkOnly(kids[i]);
    if (mark) {
      const href = mark.attrs?.href as string;
      let j = i;
      let text = "";
      while (j < kids.length) {
        const m = linkOnly(kids[j]);
        if (!m || m.attrs?.href !== href) break;
        text += kids[j].text ?? "";
        j++;
      }
      if (text === href && ANGLE_URL.test(href)) {
        content.push({
          type: "text",
          text: "",
          marks: [{ type: "link", attrs: { ...mark.attrs, angle: true } }],
        });
        i = j - 1;
        continue;
      }
    }
    if (isUnderlined(kids[i])) {
      let j = i;
      while (j < kids.length && isUnderlined(kids[j])) j++;
      const run = kids.slice(i, j);
      const plus = run.some(
        (n) => n.marks!.length > 1 || NEEDS_MARKDOWN.test(n.text ?? ""),
      );
      for (const n of run) {
        content.push(
          plus
            ? {
                ...n,
                marks: n.marks!.map((m) =>
                  m.type === "underline" ? { ...m, attrs: { ...m.attrs, plus: true } } : m,
                ),
              }
            : n,
        );
      }
      i = j - 1;
      continue;
    }
    content.push(spellMarks(kids[i]));
  }
  return { ...node, content };
}

/**
 * The serializer backslash-escapes `\ ` * _ [ ] ~` in every text node, whether
 * or not the character could be read as syntax: `snake\_case`, `\[\[Note\]\]`.
 * Orca's approach (rich-markdown-literal-serialization): an optional escape is
 * dropped only if re-parsing proves the document is unchanged.
 */
const ESCAPABLE = new Set(["*", "_", "[", "]", "~", "`"]);

/** Offsets of each `\` that escapes a candidate character. `\\` pairs are skipped. */
function escapeOffsets(md: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < md.length - 1; i++) {
    if (md[i] !== "\\") continue;
    if (ESCAPABLE.has(md[i + 1])) out.push(i);
    i++; // the escaped character is never itself an escape
  }
  return out;
}

function without(md: string, offsets: number[]): string {
  const drop = new Set(offsets);
  let out = "";
  for (let i = 0; i < md.length; i++) if (!drop.has(i)) out += md[i];
  return out;
}

/** Adjacent text nodes with equal marks are one text, however they were split. */
function normalize(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const content: JSONContent[] = [];
  for (const child of node.content.map(normalize)) {
    const last = content[content.length - 1];
    if (
      last?.type === "text" &&
      child.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(child.marks ?? [])
    ) {
      content[content.length - 1] = { ...last, text: last.text! + child.text! };
    } else content.push(child);
  }
  return { ...node, content };
}

export function cleanEscapes(editor: Editor, md: string): string {
  const manager = editor.markdown;
  if (!manager) throw new Error("cleanEscapes: the editor has no markdown manager");
  const key = (text: string) => JSON.stringify(normalize(manager.parse(text)));
  const baseline = key(md);
  const keeps = (candidate: string) => key(candidate) === baseline;

  // Greedy over a hierarchy of groups: everything at once, then per character,
  // then per line and character (a leaf; `_` splits once more into the
  // intraword ones, `snake_case`, and the rest). A pair such as `\*x\*` is
  // never split, so it is dropped together or kept together.
  const accepted: number[] = [];
  const attempt = (group: number[], split: ((g: number[]) => number[][]) | null): void => {
    if (group.length === 0) return;
    if (keeps(without(md, [...accepted, ...group]))) {
      accepted.push(...group);
      return;
    }
    if (split === null) return;
    const parts = split(group);
    if (parts.length <= 1 && parts[0]?.length === group.length) return;
    for (const part of parts) attempt(part, null);
  };
  const by = (keyOf: (o: number) => string) => (g: number[]): number[][] => {
    const m = new Map<string, number[]>();
    for (const o of g) {
      const k = keyOf(o);
      m.set(k, [...(m.get(k) ?? []), o]);
    }
    return [...m.values()];
  };
  const lineOf = (o: number) => md.lastIndexOf("\n", o).toString();
  const intraword = (o: number) =>
    md[o + 1] === "_" && /[\p{L}\p{N}]/u.test(md[o - 1] ?? "") && /[\p{L}\p{N}]/u.test(md[o + 2] ?? "");
  const leaf = by((o) => `${lineOf(o)}|${md[o + 1] === "]" ? "[" : md[o + 1]}|${intraword(o)}`);
  const all = escapeOffsets(md);
  attempt(all, (g) => by((o) => (md[o + 1] === "[" || md[o + 1] === "]" ? "[]" : md[o + 1]))(g));
  // Characters that failed as a whole are retried per line.
  const rest = all.filter((o) => !accepted.includes(o));
  for (const part of leaf(rest)) attempt(part, null);
  return accepted.length > 0 ? without(md, accepted) : md;
}
