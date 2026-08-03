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
 * The browser a link is handed to, by application name rather than by letting
 * LaunchServices pick.
 *
 * Two Zen installs live on this machine, a personal one and a work one, and
 * BOTH declare the bundle identifier `app.zen-browser.zen`. LaunchServices
 * resolves the default http/https handler by bundle id, so it cannot tell them
 * apart and links land in whichever it resolves first, which in practice is the
 * work profile. Setting the default browser cannot fix that: both apps *are*
 * the default browser.
 *
 * Naming the app sidesteps the collision, because `open -a <name>` resolves by
 * name. This is the same escape hatch `~/bin/zen-route` already uses.
 *
 * The alternative was giving the work install its own bundle id, which was
 * measured and rejected: it requires re-signing a Developer-ID + hardened
 * runtime app, and an ad-hoc re-sign has to drop
 * `com.apple.developer.web-browser.public-key-credential` (team-bound) to launch
 * at all, which would break passkeys in that browser.
 */
const EXTERNAL_BROWSER = "Zen Browser";

/**
 * Hand a link's href to the OS. Tauri's opener plugin in the app; `window.open`
 * on the plain-browser surface (`http://localhost:4949/`, dev harness), which
 * is a supported way to run the frontend and has no IPC bridge to call.
 *
 * The plain-browser branch cannot choose an application, so it keeps the
 * system default. That surface is a dev affordance, not the shipping path.
 */
export function openExternal(href: string): void {
  if (inTauri) {
    void openUrl(href, EXTERNAL_BROWSER);
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
