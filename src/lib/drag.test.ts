import { describe, expect, it } from "vitest";

import { CLICK_SLOP, isClick, nextWindowPosition } from "./drag";

const origin = { screenX: 100, screenY: 200 };

describe("isClick (title-bar click vs drag)", () => {
  it("treats a perfectly still press as a click", () => {
    expect(isClick(origin, 100, 200)).toBe(true);
  });

  it("tolerates hand tremor up to the slop, on both axes", () => {
    expect(isClick(origin, 100 + CLICK_SLOP, 200 - CLICK_SLOP)).toBe(true);
    expect(isClick(origin, 100 - CLICK_SLOP, 200 + CLICK_SLOP)).toBe(true);
  });

  it("is a drag once either axis passes the slop", () => {
    expect(isClick(origin, 100 + CLICK_SLOP + 1, 200)).toBe(false);
    expect(isClick(origin, 100, 200 - CLICK_SLOP - 1)).toBe(false);
  });
});

describe("nextWindowPosition", () => {
  it("moves the window by the logical mouse delta, scaled to physical px", () => {
    const start = { winX: 400, winY: 600, ...origin };
    expect(nextWindowPosition(start, 110, 190, 2)).toEqual({ x: 420, y: 580 });
  });
});
