/**
 * Fuzzy matching + ranking for the note switcher (step 06).
 *
 * Pure and unit-tested. Subsequence matcher with the usual bonuses:
 * consecutive runs and word-boundary hits score higher, and a title match
 * always outranks a content-only match. Pinned notes sort above unpinned
 * regardless of score (spec: pinned on top).
 */

export interface Searchable {
  id: string;
  title: string;
  content: string;
}

const CONSECUTIVE_BONUS = 8;
const WORD_START_BONUS = 10;
const BASE_HIT = 1;
/** Any title match beats any content-only match. */
const TITLE_WEIGHT = 1000;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === "\n";
}

/**
 * Score `query` as a subsequence of `text`; null when it doesn't match.
 * Greedy left-to-right — good enough for a switcher, no DP needed.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;

  let score = 0;
  let ti = 0;
  let prevHit = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += BASE_HIT;
    if (found === prevHit + 1) score += CONSECUTIVE_BONUS;
    if (isWordStart(t, found)) score += WORD_START_BONUS;
    prevHit = found;
    ti = found + 1;
  }
  // Earlier + tighter matches edge out sprawling ones.
  score -= Math.floor(prevHit / 10);
  return score;
}

export interface RankedNote<T extends Searchable> {
  note: T;
  pinned: boolean;
  score: number;
}

/**
 * Filter + rank notes for the switcher: empty query keeps everything
 * (pinned first, then given order); otherwise fuzzy over title + content,
 * pinned block on top, score descending inside each block.
 */
export function rankNotes<T extends Searchable>(
  query: string,
  notes: readonly T[],
  pinnedIds: readonly string[],
): RankedNote<T>[] {
  const pinned = new Set(pinnedIds);
  const ranked: RankedNote<T>[] = [];
  for (const note of notes) {
    let score: number | null;
    if (query.trim() === "") {
      score = 0;
    } else {
      const titleScore = fuzzyScore(query, note.title);
      const contentScore = fuzzyScore(query, note.content);
      score =
        titleScore !== null
          ? TITLE_WEIGHT + titleScore
          : contentScore;
    }
    if (score === null) continue;
    ranked.push({ note, pinned: pinned.has(note.id), score });
  }
  ranked.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.score - a.score;
  });
  return ranked;
}
