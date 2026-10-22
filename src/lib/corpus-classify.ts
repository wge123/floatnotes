/**
 * Pure classifier for the corpus check (ADR 0017). Given a note's original
 * bytes, its saved bytes and the content facts read from the editor before and
 * after, it says whether the save changed nothing, only restyled, or lost
 * content. See scripts/corpus-check/corpus-check.corpus.ts for how facts are read.
 */
import type { SourceFacts } from "./source-facts";

export type NoteClass = "unchanged" | "restyle" | "content lost";

export interface NoteFacts {
  /** Editor plain text, whitespace-normalised per line (see the runner). */
  text: string;
  /** Every link href, in document order (compared as a multiset). */
  links: string[];
  /** Every image src, in document order (compared as a multiset). */
  images: string[];
  /** Number of hard line breaks inside paragraphs: content, not style. */
  hardBreaks: number;
  /** The raw front matter block, or null. Compared as a string. */
  frontMatter: string | null;
}

export interface Classification {
  class: NoteClass;
  /** One line each: why it is a restyle, or what content differs. */
  reasons: string[];
  /** True when saving the saved note again changes it again. */
  nonConvergent: boolean;
}

const sorted = (xs: string[]) => [...xs].sort();
const sameMultiset = (a: string[], b: string[]) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** What `a` has that `b` lacks (and the reverse), clipped, for a reason line. */
function missing(a: string[], b: string[]): string {
  const rest = [...b];
  const gone = a.filter((x) => {
    const i = rest.indexOf(x);
    if (i >= 0) rest.splice(i, 1);
    return i < 0;
  });
  const clip = (s: string) => JSON.stringify(s.length > 60 ? s.slice(0, 60) + "…" : s);
  const parts: string[] = [];
  if (gone.length > 0) parts.push(`lost ${gone.slice(0, 3).map(clip).join(", ")}`);
  if (rest.length > 0) parts.push(`gained ${rest.slice(0, 3).map(clip).join(", ")}`);
  return parts.join("; ");
}

/** Clip around the first character where the lines differ. */
const around = (s: string, at: number) =>
  (at > 20 ? "…" : "") + s.slice(Math.max(0, at - 20), at + 40) + (s.length > at + 40 ? "…" : "");

/** First line (1-based) where two texts differ, showing the differing spot. */
export function firstDifference(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    const x = la[i] ?? "(none)";
    const y = lb[i] ?? "(none)";
    if (x !== y) {
      let at = 0;
      while (at < x.length && at < y.length && x[at] === y[at]) at++;
      return `line ${i + 1}: ${JSON.stringify(around(x, at))} -> ${JSON.stringify(around(y, at))}`;
    }
  }
  return "no differing line";
}

export function classifyNote(input: {
  original: string;
  saved: string;
  resaved: string;
  before: NoteFacts;
  after: NoteFacts;
  /** Facts read from the text, not the editor; see source-facts.ts. */
  sourceBefore?: SourceFacts;
  sourceAfter?: SourceFacts;
}): Classification {
  const { original, saved, resaved, before, after } = input;
  const nonConvergent = resaved !== saved;

  if (original === saved) {
    return { class: "unchanged", reasons: [], nonConvergent };
  }

  const lost: string[] = [];
  if (before.text !== after.text) {
    lost.push(`text differs, ${firstDifference(before.text, after.text)}`);
  }
  if (!sameMultiset(before.links, after.links)) {
    lost.push(
      `links differ (${before.links.length} -> ${after.links.length})`,
    );
  }
  if (!sameMultiset(before.images, after.images)) {
    lost.push(
      `images differ (${before.images.length} -> ${after.images.length})`,
    );
  }
  if (before.hardBreaks !== after.hardBreaks) {
    lost.push(
      `line breaks differ (${before.hardBreaks} -> ${after.hardBreaks})`,
    );
  }
  if (before.frontMatter !== after.frontMatter) {
    lost.push("front matter differs");
  }

  const { sourceBefore: sb, sourceAfter: sa } = input;
  if (sb && sa) {
    const bw = sb.words.join(" ");
    const aw = sa.words.join(" ");
    if (bw !== aw) lost.push(`source text differs, ${firstDifference(bw, aw)}`);
    if (!sameMultiset(sb.links, sa.links)) {
      lost.push(`source links differ (${sb.links.length} -> ${sa.links.length})`);
    }
    if (!sameMultiset(sb.images, sa.images)) {
      lost.push(`source images differ (${sb.images.length} -> ${sa.images.length})`);
    }
    if (sb.hardBreaks !== sa.hardBreaks) {
      lost.push(`source line breaks differ (${sb.hardBreaks} -> ${sa.hardBreaks})`);
    }
    if (!sameMultiset(sb.unusedDefs, sa.unusedDefs)) {
      lost.push(
        `unused definitions differ (${sb.unusedDefs.length} -> ${sa.unusedDefs.length}): ${missing(sb.unusedDefs, sa.unusedDefs)}`,
      );
    }
    if (!sameMultiset(sb.rawSources, sa.rawSources)) {
      lost.push(`raw HTML differs: ${missing(sb.rawSources, sa.rawSources)}`);
    }
    if (sb.frontMatter !== sa.frontMatter) lost.push("source front matter differs");
  }

  if (lost.length > 0) {
    return { class: "content lost", reasons: lost, nonConvergent };
  }
  return {
    class: "restyle",
    reasons: [`bytes differ, ${firstDifference(original, saved)}`],
    nonConvergent,
  };
}
