/**
 * Content facts read from a note's TEXT with marked's lexer, without the
 * editor (corpus check, ADR 0017). The editor-based facts in the runner can
 * only see what the editor loaded; if the editor drops something on load, both
 * the "before" and "after" miss it. These facts come from the original bytes.
 */
export interface SourceFacts {
  /** Visible words in document order: entities decoded, markup gone. */
  words: string[];
  /** Every link href (reference links resolved, autolinks included). */
  links: string[];
  /** Every image src. */
  images: string[];
  /** HTML, comments and footnote definitions, verbatim (trailing newlines off). */
  rawSources: string[];
  /** Hard line breaks (`  \n`, `\\\n`, `<br>`). */
  hardBreaks: number;
  /** Reference definitions whose URL no link or image uses (kept nowhere else). */
  unusedDefs: string[];
  /** The raw front matter block, or null. */
  frontMatter: string | null;
}

export function sourceFacts(_text: string): SourceFacts {
  return {
    words: [],
    links: [],
    images: [],
    rawSources: [],
    hardBreaks: 0,
    unusedDefs: [],
    frontMatter: null,
  };
}
