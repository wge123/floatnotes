import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { openUrl } from "@tauri-apps/plugin-opener";

const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * Schemes a click may hand to the OS. This is the same set
 * `tauri-plugin-opener`'s `allow-default-urls` scope permits (see
 * src-tauri/capabilities/default.json, permission `opener:default`), restated
 * here because the browser surface on :4949 has no Tauri ACL enforcing it, and
 * because a note is just a file anyone can write: `[click me](javascript:...)`
 * is a document the editor must be able to load without handing the WebView a
 * script to run. Relative links (`./other.md`) fall through too, since they
 * have no meaning to the OS opener and note-to-note linking does not exist yet.
 */
const OPENABLE = /^(https?|mailto|tel):/i;

/** True when this click should leave the editor and open `href` externally. */
export function shouldOpen(href: string | null | undefined): href is string {
  return !!href && OPENABLE.test(href);
}

/**
 * Hand a link's href to the OS. Tauri's opener plugin in the app; `window.open`
 * on the plain-browser surface (`http://localhost:4949/`, dev harness), which
 * is a supported way to run the frontend and has no IPC bridge to call.
 */
export function openExternal(href: string): void {
  if (inTauri) {
    void openUrl(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/**
 * Cmd-click (or Ctrl-click) on a link opens it; a plain click does not.
 *
 * The note body is contenteditable, so a plain click has to keep placing the
 * caret, otherwise link text becomes uneditable. That is why the Link extension
 * is configured `openOnClick: false`. Requiring a modifier is the same
 * convention Obsidian and Notion use.
 *
 * Registered as a DOM handler rather than ProseMirror's `handleClickOn`: the
 * decision comes from the event's modifier keys and the anchor element under
 * the pointer, neither of which needs document positions.
 */
export const LinkClick = Extension.create({
  name: "floatnotesLinkClick",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
              if (!(event.metaKey || event.ctrlKey)) return false;
              const anchor = (event.target as HTMLElement | null)?.closest("a");
              const href = anchor?.getAttribute("href");
              if (!shouldOpen(href)) return false;
              event.preventDefault();
              openExternal(href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
