// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import Editor from "./Editor";

/**
 * The Editor component over a whole note text: front matter shows as the
 * properties strip, body edits and YAML edits both report the full note.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const NOTE = "---\ntitle: Weekly\n---\n\n# Hi\n\nbody";

let container: HTMLDivElement;
let root: Root;
let onChange: Mock<(note: string) => void>;
let editor: TiptapEditor | null;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onChange = vi.fn();
  editor = null;
  await act(async () =>
    root.render(
      <Editor value={NOTE} onChange={onChange} onReady={(e) => (editor = e)} />,
    ),
  );
  await vi.waitFor(() => expect(editor).not.toBeNull());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Editor with front matter", () => {
  it("shows the front matter as a collapsed strip, not as body text", () => {
    const toggle = container.querySelector("button");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(editor!.getText()).not.toContain("title: Weekly");
  });

  it("reports the whole note with the front matter intact after a body edit", () => {
    act(() => {
      editor!.chain().insertContentAt(editor!.state.doc.content.size - 1, "!").run();
    });
    expect(onChange).toHaveBeenLastCalledWith("---\ntitle: Weekly\n---\n\n# Hi\n\nbody!");
  });

  it("reports a YAML edit as the whole note, exactly as typed", () => {
    act(() => container.querySelector("button")!.click());
    const textarea = container.querySelector("textarea")!;
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      set.call(textarea, "title: Renamed");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("---\ntitle: Renamed\n---\n\n# Hi\n\nbody");
  });
});

describe("Editor reloading after an external change", () => {
  it("parses the new text as markdown and does not save it back", async () => {
    onChange.mockClear();
    await act(async () =>
      root.render(
        <Editor
          value={"# Fresh\n\n- [ ] one\n- [x] two"}
          onChange={onChange}
          onReady={(e) => (editor = e)}
        />,
      ),
    );
    const types = editor!.getJSON().content?.map((n) => n.type);
    expect(types?.slice(0, 2)).toEqual(["heading", "taskList"]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
