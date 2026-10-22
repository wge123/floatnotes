import { describe, expect, it } from "vitest";

import { classifyNote, type NoteFacts } from "./corpus-classify";

const facts = (over: Partial<NoteFacts> = {}): NoteFacts => ({
  text: "hello\nworld",
  links: ["https://a.example"],
  images: ["pic.png"],
  hardBreaks: 0,
  frontMatter: null,
  ...over,
});

const run = (
  original: string,
  saved: string,
  before = facts(),
  after = facts(),
  resaved = saved,
) => classifyNote({ original, saved, resaved, before, after });

describe("classifyNote", () => {
  it("calls identical bytes unchanged", () => {
    const r = run("a\n", "a\n");
    expect(r.class).toBe("unchanged");
    expect(r.reasons).toEqual([]);
    expect(r.nonConvergent).toBe(false);
  });

  it("calls different bytes with equal content a restyle, naming the first differing line", () => {
    const r = run("x\n* item\n", "x\n- item\n");
    expect(r.class).toBe("restyle");
    expect(r.reasons[0]).toContain("line 2");
    expect(r.reasons[0]).toContain("* item");
    expect(r.reasons[0]).toContain("- item");
  });

  it("calls differing text content lost", () => {
    const r = run("a", "b", facts(), facts({ text: "hello" }));
    expect(r.class).toBe("content lost");
    expect(r.reasons.join()).toMatch(/text/);
  });

  it("compares links and images as multisets, ignoring order", () => {
    const same = run(
      "a",
      "b",
      facts({ links: ["x", "y", "x"] }),
      facts({ links: ["y", "x", "x"] }),
    );
    expect(same.class).toBe("restyle");
    const lost = run("a", "b", facts({ links: ["x", "x"] }), facts({ links: ["x"] }));
    expect(lost.class).toBe("content lost");
    expect(lost.reasons.join()).toMatch(/links/);
    const img = run("a", "b", facts({ images: ["p.png"] }), facts({ images: [] }));
    expect(img.reasons.join()).toMatch(/images/);
  });

  it("flags lost hard breaks and changed front matter", () => {
    const hb = run("a", "b", facts({ hardBreaks: 2 }), facts({ hardBreaks: 1 }));
    expect(hb.reasons.join()).toMatch(/line breaks/);
    const fm = run("a", "b", facts({ frontMatter: "---\na: 1\n---\n" }), facts());
    expect(fm.class).toBe("content lost");
    expect(fm.reasons.join()).toMatch(/front matter/);
  });

  it("flags non-convergence separately from the class", () => {
    const r = run("a\n", "a\n", facts(), facts(), "a\n\n");
    expect(r.class).toBe("unchanged");
    expect(r.nonConvergent).toBe(true);
  });
});
