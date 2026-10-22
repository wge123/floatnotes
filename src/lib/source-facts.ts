import { Lexer, type Token, type Tokens } from "marked";

import { splitFrontMatter } from "./front-matter";

/**
 * Content facts read from a note's TEXT with marked's lexer, without the
 * editor (corpus check, ADR 0017). The editor-based facts in the runner can
 * only see what the editor loaded; if the editor drops something on load, both
 * the "before" and "after" miss it. These facts come from the original bytes,
 * and the same function reads the saved bytes for the "after".
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

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The entities a text token keeps undecoded; the rest stay as written. */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// The tags the editor owns (a `<br>` is a hard break, `<u>` is underline); the
// same set raw-blocks.ts does not keep raw.
const OWNED_TAG = /^<\/?(?:br|u)\b/i;
const BR_TAG = /^<br\b/i;
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]\s]+\]:/;

export function sourceFacts(text: string): SourceFacts {
  const { frontMatter, body } = splitFrontMatter(text);
  const facts: SourceFacts = {
    words: [],
    links: [],
    images: [],
    rawSources: [],
    hardBreaks: 0,
    unusedDefs: [],
    frontMatter: frontMatter?.raw ?? null,
  };
  const defs: string[] = [];

  // Breaks seen since the last visible content. A break that ends its block is
  // dropped by a save on purpose, so it only counts once content follows.
  let pending = 0;
  const commit = () => {
    facts.hardBreaks += pending;
    pending = 0;
  };

  /** The text one inline run shows, one string per block. */
  const inline = (tokens: Token[] | undefined): string => {
    let out = "";
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "text":
        case "escape":
        case "codespan":
          if ((t as Tokens.Text).tokens) out += inline((t as Tokens.Text).tokens);
          else {
            const shown = decode((t as Tokens.Text).text);
            if (shown.trim() !== "") commit();
            out += shown;
          }
          break;
        case "br":
          pending++;
          out += " ";
          break;
        case "html": {
          const raw = t.raw;
          if (BR_TAG.test(raw)) {
            pending++;
            out += " ";
          } else if (!OWNED_TAG.test(raw)) facts.rawSources.push(raw);
          break;
        }
        case "link":
          facts.links.push((t as Tokens.Link).href);
          commit();
          out += inline((t as Tokens.Link).tokens);
          break;
        case "image":
          facts.images.push((t as Tokens.Image).href);
          commit();
          break;
        default:
          out += inline((t as Tokens.Generic).tokens);
      }
    }
    return out;
  };

  const blocks: string[] = [];
  const inlineBlock = (tokens: Token[] | undefined): string => {
    pending = 0;
    return inline(tokens);
  };
  const block = (tokens: Token[]): void => {
    for (const t of tokens) {
      switch (t.type) {
        case "html":
          facts.rawSources.push(t.raw.replace(/\s+$/, ""));
          break;
        case "code":
          blocks.push((t as Tokens.Code).text);
          break;
        case "def": {
          const d = t as Tokens.Def;
          if (d.tag.startsWith("^")) facts.rawSources.push(t.raw.replace(/\n+$/, ""));
          else defs.push(d.href);
          break;
        }
        case "list":
          for (const item of (t as Tokens.List).items) block(item.tokens);
          break;
        case "table": {
          const tbl = t as Tokens.Table;
          for (const cell of tbl.header) blocks.push(inlineBlock(cell.tokens));
          for (const row of tbl.rows) for (const cell of row) blocks.push(inlineBlock(cell.tokens));
          break;
        }
        case "blockquote":
          block((t as Tokens.Blockquote).tokens);
          break;
        case "space":
        case "hr":
        case "checkbox":
          break;
        case "text":
        case "paragraph":
        case "heading":
          // marked reads `[^1]: text` as a paragraph unless it is bare; the
          // editor keeps the definition verbatim as a raw block.
          if (FOOTNOTE_DEF.test(t.raw)) facts.rawSources.push(t.raw.replace(/\n+$/, ""));
          blocks.push(inlineBlock((t as Tokens.Generic).tokens ?? [t]));
          break;
        default:
          if ((t as Tokens.Generic).tokens) block((t as Tokens.Generic).tokens!);
      }
    }
  };

  block(new Lexer({ gfm: true }).lex(body));
  facts.words = blocks.flatMap((b) => b.split(/\s+/).filter((w) => w !== ""));
  const used = new Set([...facts.links, ...facts.images]);
  facts.unusedDefs = defs.filter((href) => !used.has(href));
  return facts;
}
