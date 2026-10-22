import type { Editor } from "@tiptap/core";
import { TrailingNode } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const trailingParagraph = new PluginKey<ProseMirrorNode | null>(
  "floatnotesTrailingParagraph",
);

/**
 * StarterKit's trailing node keeps an empty paragraph after a final table,
 * code block or quote so there is always somewhere to click and type. That
 * paragraph is UI scaffolding until the user types in it, so this wrapper
 * remembers the one the plugin inserted and `getSerializationDocument` leaves
 * it out of the saved text while it is untouched. Modelled on Orca's
 * rich-markdown-trailing-paragraph.ts.
 */
export const TrailingParagraph = TrailingNode.extend({
  // The stock plugin only appends the node when some transaction runs, so a
  // note that opens ending in a table would have nowhere to click until the
  // first keystroke or click. An empty transaction on create settles it. It
  // fires no update event (the doc change is the plugin's, not the root
  // transaction's), so opening a note still never writes it.
  onCreate() {
    this.editor.view.dispatch(
      this.editor.state.tr.setMeta("preventUpdate", true),
    );
  },

  addProseMirrorPlugins() {
    const plugins = (this.parent?.() ?? []).map((plugin) => {
      const append = plugin.spec.appendTransaction;
      if (!append) return plugin;
      return new Plugin({
        ...plugin.spec,
        appendTransaction(transactions, oldState, state) {
          const transaction = append.call(plugin, transactions, oldState, state);
          if (transaction) {
            transaction.setMeta(trailingParagraph, transaction.doc.lastChild);
            // Scaffolding, not an edit: Undo must not step through it.
            transaction.setMeta("addToHistory", false);
          }
          return transaction;
        },
      });
    });
    return [
      ...plugins,
      new Plugin<ProseMirrorNode | null>({
        key: trailingParagraph,
        state: {
          init: () => null,
          apply(transaction, previous, oldState) {
            const inserted: unknown = transaction.getMeta(trailingParagraph);
            if (inserted === transaction.doc.lastChild && transaction.doc.lastChild) {
              return transaction.doc.lastChild;
            }
            if (!previous || !transaction.docChanged) return previous;
            // Did any step touch the remembered paragraph? If so the user
            // typed in it and it is content from now on.
            let start = oldState.doc.content.size - previous.nodeSize;
            let touched = false;
            for (const map of transaction.mapping.maps) {
              map.forEach((from, to) => {
                if (from <= start + previous.nodeSize && to > start) touched = true;
              });
              start = map.map(start, 1);
            }
            return !touched && transaction.doc.lastChild === previous
              ? previous
              : null;
          },
        },
      }),
    ];
  },
});

/** The document to serialize: the live one minus an untouched trailing paragraph. */
export function getSerializationDocument(editor: Editor): ProseMirrorNode {
  const doc = editor.state.doc;
  const synthetic = trailingParagraph.getState(editor.state);
  return synthetic && doc.lastChild === synthetic
    ? doc.copy(doc.content.cut(0, doc.content.size - synthetic.nodeSize))
    : doc;
}
