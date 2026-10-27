import { afterEach, describe, expect, it, vi } from "vitest";
import { deeplinkUrl } from "./api";

function at(protocol: string, port: string, origin: string) {
  vi.stubGlobal("window", { location: { protocol, port, origin } });
}

describe("deeplinkUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("points at a FLOATNOTES_PORT override when the page is served by that server", () => {
    at("http:", "4960", "http://localhost:4960");
    expect(deeplinkUrl("a/b")).toBe("http://localhost:4960/?note=a%2Fb");
  });

  it("round-trips an id with reserved characters through URLSearchParams", () => {
    at("http:", "4949", "http://localhost:4949");
    const id = "a&b #c+d%e.md";
    expect(new URL(deeplinkUrl(id)).searchParams.get("note")).toBe(id);
    expect(new URL(deeplinkUrl("a/b")).searchParams.get("note")).toBe("a/b");
  });

  it("points at the default server on :4949", () => {
    at("http:", "4949", "http://localhost:4949");
    expect(deeplinkUrl("x")).toBe("http://localhost:4949/?note=x");
  });

  it("falls back to the default server from the Vite dev page", () => {
    at("http:", "1420", "http://localhost:1420");
    expect(deeplinkUrl("x")).toBe("http://127.0.0.1:4949/?note=x");
  });

  it("falls back to the default server from the release webview", () => {
    at("tauri:", "", "tauri://localhost");
    expect(deeplinkUrl("x")).toBe("http://127.0.0.1:4949/?note=x");
  });
});
