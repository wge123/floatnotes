import { describe, expect, it } from "vitest";

import appSource from "../App.tsx?raw";
import formatBarSource from "../components/FormatBar.tsx?raw";
import tauriConfig from "../../src-tauri/tauri.conf.json";

/**
 * H4 regression guard.
 *
 * The app root is `overflow-hidden`, so anything wider than the window is cut
 * with no scrollbar and no affordance. The bottom bar was losing the word
 * count and the task-list button entirely below ~381px. Two things keep that
 * from coming back: a window floor wide enough for the format toolbar's one
 * row (measured at ~316px + padding + count), and a bar that is allowed to
 * wrap. jsdom has no layout engine, so the wrap is asserted as the CSS
 * contract that produces it — the pixel measurement lives in the audit probe.
 */
const main = tauriConfig.app.windows.find((w) => w.label === "main");

describe("window bounds", () => {
  it("declares a floor for the main window", () => {
    expect(main).toBeDefined();
    expect(main?.minWidth).toBeGreaterThanOrEqual(360);
    expect(main?.minHeight).toBeGreaterThan(0);
  });

  it("never lets the floor exceed the shipped default size", () => {
    expect(main!.minWidth).toBeLessThanOrEqual(main!.width);
    expect(main!.minHeight).toBeLessThanOrEqual(main!.height);
  });
});

describe("bottom bar overflow contract", () => {
  it("lets the bar wrap instead of clipping under overflow-hidden", () => {
    const bar = appSource
      .split("\n")
      .find(
        (line) => line.includes("border-t") && line.includes("justify-between"),
      );
    expect(bar, "bottom bar container not found in App.tsx").toBeDefined();
    expect(bar).toContain("flex-wrap");
  });

  it("lets the format toolbar fold its glyphs under text zoom", () => {
    const container = formatBarSource
      .split("\n")
      .find((line) => line.includes("items-center") && line.includes("gap-0.5"));
    expect(container, "format toolbar container not found").toBeDefined();
    expect(container).toContain("flex-wrap");
    expect(container).toContain("max-w-full");
  });
});
