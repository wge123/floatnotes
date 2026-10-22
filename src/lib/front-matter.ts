/**
 * Front matter (ADR 0018): a note that starts with a line that is exactly
 * `---`, then YAML lines, then a closing line that is exactly `---`. The split
 * is pure string work so the editor, the headless tests and the corpus check
 * share one definition. Anything else (no closing fence, a `---` rule that is
 * not the first line) is not front matter and stays in the body.
 */
export interface FrontMatter {
  /** The note's leading text up to the body, byte for byte. Saved as is. */
  raw: string;
  /** The lines between the fences, without the last line break. Editable. */
  yaml: string;
  /** Opening fence with its line break (`---\n`). */
  open: string;
  /** Line break the note uses, for rebuilding `raw` after a YAML edit. */
  eol: string;
  /** The closing fence, its line break and any blank lines after it. */
  after: string;
}

const FENCE = "---";

/** Split a note into its front matter (null when it has none) and the body. */
export function splitFrontMatter(text: string): {
  frontMatter: FrontMatter | null;
  body: string;
} {
  const none = { frontMatter: null, body: text };
  const firstEnd = text.indexOf("\n");
  if (firstEnd < 0) return none;
  if (text.slice(0, firstEnd).replace(/\r$/, "") !== FENCE) return none;

  const open = text.slice(0, firstEnd + 1);
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  let pos = firstEnd + 1;
  for (;;) {
    const end = text.indexOf("\n", pos);
    const lineEnd = end < 0 ? text.length : end;
    if (text.slice(pos, lineEnd).replace(/\r$/, "") === FENCE) {
      let afterEnd = end < 0 ? text.length : end + 1;
      // Blank lines that follow belong to the front matter, so they are
      // written back and the editor's content starts at the first real line.
      const blank = /^(?:[ \t]*\r?\n)+/.exec(text.slice(afterEnd));
      if (blank) afterEnd += blank[0].length;
      const inner = text.slice(open.length, pos);
      const yaml = inner.endsWith(eol) ? inner.slice(0, -eol.length) : inner;
      return {
        frontMatter: {
          raw: text.slice(0, afterEnd),
          yaml,
          open,
          eol,
          after: text.slice(pos, afterEnd),
        },
        body: text.slice(afterEnd),
      };
    }
    if (end < 0) return none;
    pos = end + 1;
  }
}

/** The front matter with its YAML replaced by exactly what was typed. */
export function withYaml(frontMatter: FrontMatter, yaml: string): FrontMatter {
  const inner = yaml === "" ? "" : yaml + frontMatter.eol;
  return { ...frontMatter, yaml, raw: frontMatter.open + inner + frontMatter.after };
}
