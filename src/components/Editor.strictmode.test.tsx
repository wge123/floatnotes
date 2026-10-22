// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { expect, it, vi } from "vitest";

import Editor from "./Editor";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * main.tsx renders under StrictMode, where useEditor destroys and recreates the
 * editor. App must end up holding the live one, not the destroyed first.
 */
it("hands onReady a live editor under StrictMode", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let held: TiptapEditor | null = null;
  await act(async () =>
    root.render(
      <StrictMode>
        <Editor
          value="hello"
          onChange={() => {}}
          onReady={(e) => (held = e)}
        />
      </StrictMode>,
    ),
  );
  await vi.waitFor(() => expect(held).not.toBeNull());
  expect(held!.isDestroyed).toBe(false);
  expect(() => held!.commands.focus()).not.toThrow();
  expect(held!.chain().focus().toggleBold().run()).toBe(true);
  act(() => root.unmount());
  container.remove();
});
