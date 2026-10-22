// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import PropertiesStrip from "./PropertiesStrip";

/**
 * The properties strip over a note's front matter (ADR 0018): one collapsed
 * line, a plain textarea of the raw YAML when opened.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const YAML = "title: Weekly review\ntags: [review]";

let container: HTMLDivElement;
let root: Root;
let onChange: Mock<(yaml: string) => void>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onChange = vi.fn();
  act(() => root.render(<PropertiesStrip yaml={YAML} onChange={onChange} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const toggle = () => container.querySelector("button") as HTMLButtonElement;
const box = () => container.querySelector("textarea") as HTMLTextAreaElement | null;

describe("PropertiesStrip", () => {
  it("starts collapsed as one keyboard-reachable control", () => {
    expect(toggle()).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(box()).toBeNull();
  });

  it("names the front matter and previews its first line", () => {
    expect(toggle().textContent).toContain("Properties");
    expect(toggle().textContent).toContain("title: Weekly review");
  });

  it("expands to a plain text box over the raw YAML", () => {
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(box()?.value).toBe(YAML);
  });

  it("reports an edit exactly as typed", () => {
    act(() => toggle().click());
    const textarea = box()!;
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      set.call(textarea, "title: Edited\n  indented: yes");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("title: Edited\n  indented: yes");
  });

  it("collapses again", () => {
    act(() => toggle().click());
    act(() => toggle().click());
    expect(box()).toBeNull();
  });
});
