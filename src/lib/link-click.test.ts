import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const TAURI = "__TAURI_INTERNALS__";
const globals = window as unknown as Record<string, unknown>;

/**
 * `inTauri` is computed once at module load, so each branch needs a fresh
 * import with the global already in its intended state. Hence resetModules
 * plus dynamic import rather than a top-level import of link-click.
 */
async function loadIn(surface: "app" | "browser") {
  vi.resetModules();
  if (surface === "app") globals[TAURI] = {};
  else delete globals[TAURI];
  return import("./link-click");
}

describe("openExternal picks the browser by name, not by bundle id", () => {
  beforeEach(() => openUrl.mockClear());
  afterEach(() => {
    delete globals[TAURI];
    vi.restoreAllMocks();
  });

  /**
   * Both Zen installs on this machine declare `app.zen-browser.zen`, so
   * LaunchServices cannot tell the personal one from the work one and sends
   * links to whichever it resolves first. Naming the app is what stops a note's
   * links opening in the work browser, so the argument is the whole fix and is
   * asserted exactly.
   */
  it("names the personal Zen when running in the app", async () => {
    const { openExternal } = await loadIn("app");

    openExternal("https://mdblist.com");

    expect(openUrl).toHaveBeenCalledWith("https://mdblist.com", "Zen Browser");
  });

  it("keeps the system default on the plain-browser surface", async () => {
    const { openExternal } = await loadIn("browser");
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openExternal("https://mdblist.com");

    // window.open cannot choose an application, so this surface has no say.
    expect(open).toHaveBeenCalledWith(
      "https://mdblist.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("shouldOpen gates which schemes leave the editor", () => {
  it.each([
    ["https://example.com", true],
    ["http://127.0.0.1:6400", true],
    ["mailto:someone@example.com", true],
    ["tel:+15551234", true],
    // A note is a file anyone can write, so a script URL must never be handed
    // to the OS or the WebView.
    ["javascript:alert(1)", false],
    // Absolute paths and note-to-note links mean nothing to the OS opener.
    ["file:///Users/willem/Notes/stremio-run.md", false],
    ["./other-note.md", false],
    ["", false],
  ])("%s -> %s", async (href, expected) => {
    const { shouldOpen } = await loadIn("browser");
    expect(shouldOpen(href)).toBe(expected);
  });
});
