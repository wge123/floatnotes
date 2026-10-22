import { Extension } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Pasted plain text is read as markdown (@tiptap/markdown has no paste
 * conversion; tiptap-markdown had transformPastedText). It goes through the
 * editor's own markdown manager, so it gets the same marked instance and
 * fixups as a loaded note. A paste that carries HTML, or lands in a code
 * block, keeps ProseMirror's default.
 */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            const text = data?.getData("text/plain");
            if (!text || data?.getData("text/html")) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const manager = editor.markdown;
            if (!manager) return false;

            const doc = manager.parse(text);
            const nodes = (doc.content ?? []).map((json) =>
              view.state.schema.nodeFromJSON(json),
            );
            if (nodes.length === 0) return false;

            // Open a leading/trailing paragraph so it merges into the text
            // around the caret instead of splitting it.
            const openStart = nodes[0].type.name === "paragraph" ? 1 : 0;
            const openEnd = nodes[nodes.length - 1].type.name === "paragraph" ? 1 : 0;
            const slice = new Slice(Fragment.from(nodes), openStart, openEnd);
            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste"),
            );
            return true;
          },
        },
      }),
    ];
  },
});
