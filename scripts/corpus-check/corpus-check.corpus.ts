/**
 * Corpus check (ADR 0017): what would an editor change do to every real note?
 *
 * Run it with `CORPUS_NOTES_DIR=~/Notes bun run corpus-check` (docs/ux-testing.md).
 * It runs as a vitest file under its own config (vitest.corpus.config.ts)
 * because TipTap needs a DOM and jsdom is already the repo's DOM. The file
 * name (.corpus.ts, not .test.ts) keeps it out of `bunx vitest run`, whose
 * default pattern only collects *.test.* / *.spec.* files.
 *
 * What it does, per note:
 *   1. copies every .md file under the input dir (recursively; dot-dirs such
 *      as .trash are skipped) into an os-tmpdir scratch dir. The input dir is
 *      only ever read.
 *   2. loadNote -> real production extensions in a headless editor -> saveNote.
 *   3. reloads the saved text and saves again (convergence check).
 *
 * Classes (classifier: src/lib/corpus-classify.ts):
 *   unchanged     saved bytes equal the original.
 *   restyle       bytes differ, content equal.
 *   content lost  content differs.
 * "Content" is, read through the same editor from the original and from the
 * saved text: the editor's plain text (one line per block, whitespace runs
 * collapsed so soft line breaks do not count, empty blocks dropped), the multiset of link hrefs, the multiset of
 * image srcs, the count of hard line breaks, and the front matter as a string.
 * Pure restyling (`*` vs `-`, `__b__` vs `**b**`, reference vs inline links,
 * table padding) changes none of these.
 * Separately flagged: non-convergent (save(save(x)) != save(x)).
 *
 * Env: CORPUS_NOTES_DIR (required), CORPUS_REPORT (optional file for the
 * report), CORPUS_MAX_LINES (changed notes listed per class, default 200).
 * Exit code is non-zero when any note is content lost.
 */
import { Editor } from "@tiptap/core";
import { afterAll, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";

import { classifyNote, type NoteFacts } from "../../src/lib/corpus-classify";
import {
  buildEditorExtensions,
  loadNote,
  saveNote,
} from "../../src/lib/editor-extensions";
import type { FrontMatter } from "../../src/lib/front-matter";

const expand = (p: string) => (p.startsWith("~") ? homedir() + p.slice(1) : p);

function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue; // .trash and any dot-dir/file
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

function withEditor<T>(text: string, fn: (e: Editor, fm: FrontMatter | null) => T): T {
  const { frontMatter, content } = loadNote(text);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content,
    contentType: "markdown",
  });
  try {
    return fn(editor, frontMatter);
  } finally {
    editor.destroy();
  }
}

function readFacts(editor: Editor, fm: FrontMatter | null): NoteFacts {
  const links: string[] = [];
  const images: string[] = [];
  let hardBreaks = 0;
  editor.state.doc.descendants((node, _pos, parent, index) => {
    if (node.type.name === "image") images.push(String(node.attrs.src ?? ""));
    // A break at the end of its block says nothing in markdown (it renders as
    // no break at all), so it is not content.
    if (
      node.type.name === "hardBreak" &&
      parent &&
      index < parent.childCount - 1
    ) {
      hardBreaks++;
    }
    for (const m of node.marks) {
      if (m.type.name === "link") links.push(String(m.attrs.href ?? ""));
    }
  });
  // Blocks stay on their own lines; inside a block every whitespace run,
  // soft line breaks included, is one space (a soft break is style).
  const text = editor
    .getText({ blockSeparator: "\u0001" })
    .split("\u0001")
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter((b) => b !== "")
    .join("\n");
  return { text, links, images, hardBreaks, frontMatter: fm?.raw ?? null };
}

const notesDir = process.env.CORPUS_NOTES_DIR
  ? expand(process.env.CORPUS_NOTES_DIR)
  : "";
const reportPath = process.env.CORPUS_REPORT
  ? expand(process.env.CORPUS_REPORT)
  : "";
const maxLines = Number(process.env.CORPUS_MAX_LINES ?? 200);
const scratch = mkdtempSync(join(tmpdir(), "floatnotes-corpus-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

it("reports every note a save would change", { timeout: 30 * 60_000 }, () => {
  expect(notesDir, "set CORPUS_NOTES_DIR to the notes directory").not.toBe("");
  expect(existsSync(notesDir), `${notesDir} does not exist`).toBe(true);

  // Copy first; everything after reads the copy, never the input.
  const copy = join(scratch, "notes");
  mkdirSync(copy);
  for (const src of listMarkdown(notesDir)) {
    const dest = join(copy, relative(notesDir, src));
    mkdirSync(join(dest, ".."), { recursive: true });
    cpSync(src, dest);
  }

  const rows: {
    path: string;
    cls: string;
    reasons: string[];
    nonConvergent: boolean;
  }[] = [];
  const errors: string[] = [];
  const files = listMarkdown(copy);
  for (const file of files) {
    const path = relative(copy, file);
    try {
      const original = readFileSync(file, "utf8");
      const [saved, before] = withEditor(original, (e, fm) => [
        saveNote(e, fm),
        readFacts(e, fm),
      ] as const);
      const [resaved, after] = withEditor(saved, (e, fm) => [
        saveNote(e, fm),
        readFacts(e, fm),
      ] as const);
      const r = classifyNote({ original, saved, resaved, before, after });
      rows.push({ path, cls: r.class, reasons: r.reasons, nonConvergent: r.nonConvergent });
    } catch (err) {
      errors.push(`${path}: ${(err as Error).message}`);
    }
  }

  const by = (c: string) => rows.filter((r) => r.cls === c);
  const nonConv = rows.filter((r) => r.nonConvergent);
  const lines: string[] = [
    `Corpus check of ${notesDir}`,
    `${files.length} notes: ${by("unchanged").length} unchanged, ${by("restyle").length} restyle, ${by("content lost").length} content lost, ${nonConv.length} non-convergent, ${errors.length} errored`,
    "",
  ];
  const section = (title: string, list: typeof rows) => {
    lines.push(`== ${title} (${list.length}) ==`);
    for (const r of list.slice(0, maxLines)) {
      lines.push(`${r.path}${r.nonConvergent ? " [non-convergent]" : ""}`);
      for (const why of r.reasons) lines.push(`    ${why}`);
    }
    if (list.length > maxLines) lines.push(`... ${list.length - maxLines} more`);
    lines.push("");
  };
  section("content lost", by("content lost"));
  section("restyle", by("restyle"));
  lines.push(`== non-convergent (${nonConv.length}) ==`);
  for (const r of nonConv.slice(0, maxLines)) lines.push(r.path);
  lines.push("");
  lines.push(`== errored (${errors.length}) ==`, ...errors, "");

  const report = lines.join("\n");
  if (reportPath) writeFileSync(reportPath, report);
  process.stdout.write("\n" + report + "\n");

  expect(errors, "notes that threw while loading or saving").toEqual([]);
  expect(by("content lost").map((r) => r.path), "notes that lose content").toEqual([]);
});
