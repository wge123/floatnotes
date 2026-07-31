// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/react";

import ActionPanel from "./ActionPanel";
import FindBar from "./FindBar";
import NoteSwitcher from "./NoteSwitcher";
import Tooltip from "./Tooltip";

/**
 * A11y audit M2/M3.
 *
 * M2: four elements set `outline: none` with nothing in its place — the editor
 * and the three overlay search fields, which are the primary keyboard entry
 * point into every overlay. The editor's replacement lives in App.css (a
 * `:focus-visible` rail); the three inputs carry `floatnotes-focus-inset`.
 *
 * M3: every hover affordance was hover-only. The parity scan below is the
 * regression guard — jsdom can't compute Tailwind, but a `hover:` utility with
 * no `focus-visible:` twin on the same className is exactly the defect.
 */
const noop = () => {};

/** FindBar only touches the editor from effects/handlers, which never run here. */
const stubEditor = {} as unknown as TiptapEditor;

const parse = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
};

describe("M2 — overlay search fields have a focus indicator", () => {
  const cases: Array<[string, string]> = [
    [
      "NoteSwitcher",
      renderToStaticMarkup(
        <NoteSwitcher
          pins={[]}
          currentNoteId={null}
          onOpen={noop}
          onDelete={noop}
          onClose={noop}
        />,
      ),
    ],
    [
      "ActionPanel",
      renderToStaticMarkup(<ActionPanel actions={[]} onClose={noop} />),
    ],
    [
      "FindBar",
      renderToStaticMarkup(<FindBar editor={stubEditor} onClose={noop} />),
    ],
  ];

  for (const [name, markup] of cases) {
    it(`${name}'s search input keeps a visible focus ring`, () => {
      const input = parse(markup).querySelector("input");

      expect(input).not.toBeNull();
      expect(input!.className).toContain("floatnotes-focus-inset");
      expect(input!.className).not.toContain("outline-none");
    });
  }
});

describe("M3 — Tooltip is reachable without a mouse", () => {
  const markup = renderToStaticMarkup(
    <Tooltip label="Bold" shortcut="⌘B">
      <button type="button">B</button>
    </Tooltip>,
  );
  const host = parse(markup);
  const hint = host.querySelector('[role="tooltip"]')!;
  const button = host.querySelector("button")!;

  it("describes its control, so screen readers get the chord too", () => {
    expect(hint.id).toBeTruthy();
    expect(button.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("reveals on keyboard focus as well as hover", () => {
    expect(hint.className).toContain("group-hover/tooltip:block");
    expect(hint.className).toContain("group-focus-within/tooltip:block");
  });
});

describe("M3 — every hover affordance has a focus-visible twin", () => {
  // Vite's raw glob rather than node:fs — the repo has no @types/node, and
  // this keeps the scan working from whatever cwd the runner picks.
  const sources = import.meta.glob("../**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const sourceFiles = Object.keys(sources)
    .filter((path) => !path.includes(".test."))
    .sort();

  it("finds the components to scan", () => {
    // Guard against a glob that silently matches nothing — the scan would
    // then "pass" by looking at zero files.
    expect(sourceFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of sourceFiles) {
    it(`${file} mirrors hover: with focus-visible:`, () => {
      const lines = sources[file].split("\n");

      for (const [index, line] of lines.entries()) {
        // className strings are single-line in this codebase, so the line is
        // the right unit: a hover utility and its twin live side by side.
        const hovers = [...line.matchAll(/hover:([\w-[\]./%]+)/g)].map(
          (m) => m[1],
        );
        for (const utility of hovers) {
          expect(
            line,
            `${file}:${index + 1} — hover:${utility} has no focus-visible: twin`,
          ).toContain(`focus-visible:${utility}`);
        }

        if (/\boutline-none\b/.test(line)) {
          expect(
            line,
            `${file}:${index + 1} — outline-none with no replacement`,
          ).toMatch(/focus-visible:/);
        }
      }
    });
  }
});
