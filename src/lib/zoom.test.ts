import { describe, expect, it } from "vitest";

import {
  applyZoom,
  clampZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomIn,
  zoomOut,
} from "./zoom";

describe("zoom steps", () => {
  it("steps up and down by 0.1 without float artifacts", () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    // 1.1 + 0.1 in raw floats is 1.2000000000000002.
    expect(zoomIn(1.1)).toBe(1.2);
    expect(zoomOut(0.7)).toBe(0.6);
  });

  it("clamps at the bounds", () => {
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
  });

  it("round-trips a full zoom-in then zoom-out ladder back to default", () => {
    let z = ZOOM_DEFAULT;
    for (let i = 0; i < 5; i++) z = zoomIn(z);
    for (let i = 0; i < 5; i++) z = zoomOut(z);
    expect(z).toBe(ZOOM_DEFAULT);
  });
});

describe("applyZoom", () => {
  it("scales the root font-size; null resets to the 16px base", () => {
    applyZoom(1.5);
    expect(document.documentElement.style.fontSize).toBe("24px");
    applyZoom(null);
    expect(document.documentElement.style.fontSize).toBe("16px");
  });
});
