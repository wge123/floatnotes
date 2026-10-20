// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NoteSwitcher from "./NoteSwitcher";

const metas = [
  { id: "top-note", title: "Top note", mtime: 3, folder: "", snippet: "plain" },
  {
    id: "research/deep/findings",
    title: "Findings",
    mtime: 2,
    folder: "research/deep",
    snippet: "the secret gizmo lives here",
  },
];

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../lib/api", () => ({
  api: { list: () => Promise.resolve(metas), read },
}));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  read.mockReset();
  read.mockImplementation((id: string) =>
    Promise.resolve({ ...metas.find((m) => m.id === id), content: "", path: `/n/${id}.md` }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const mount = async (onOpen = vi.fn()) => {
  await act(async () => {
    root.render(
      <NoteSwitcher
        pins={[]}
        currentNoteId={null}
        onOpen={onOpen}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
  return onOpen;
};

const type = async (text: string) => {
  const input = container.querySelector("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const rowTexts = () => [...container.querySelectorAll("li button")].map((b) => b.textContent);

describe("⌘P with notes in folders", () => {
  it("shows the folder path beside the title of a nested note only", async () => {
    await mount();
    const [top, nested] = rowTexts();
    expect(top).toContain("Top note");
    expect(top).not.toContain("/");
    expect(nested).toContain("Findings");
    expect(nested).toContain("research/deep");
  });

  it("matches on the folder path", async () => {
    await mount();
    await type("deep");
    expect(rowTexts()).toHaveLength(1);
    expect(rowTexts()[0]).toContain("Findings");
  });

  it("matches on the snippet without reading any note", async () => {
    await mount();
    await type("gizmo");
    expect(rowTexts()).toHaveLength(1);
    expect(rowTexts()[0]).toContain("Findings");
    expect(read).not.toHaveBeenCalled();
  });

  it("opens the picked nested note by id", async () => {
    const onOpen = await mount();
    const nested = container.querySelectorAll<HTMLButtonElement>("li button")[1];
    await act(async () => nested.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe("research/deep/findings");
  });
});
