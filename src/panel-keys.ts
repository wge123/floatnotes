import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Panel key shim (step 03; step 05's App shell replaces it): Esc and ⌘W hide
 * the panel — never quit. Also surfaces the Rust side's hotkey-registration
 * warning as a visible in-panel banner. No-op outside the Tauri webview
 * (e.g. the plain browser at localhost:4949).
 */
const inTauri = "__TAURI_INTERNALS__" in window;

if (inTauri) {
  window.addEventListener("keydown", (event) => {
    const isHideChord =
      event.key === "Escape" ||
      (event.metaKey && event.key.toLowerCase() === "w");
    if (!isHideChord) return;
    event.preventDefault();
    void invoke("hide_panel");
  });

  void listen<string>("floatnotes://hotkey-warning", ({ payload }) => {
    const banner = document.createElement("div");
    banner.textContent = payload;
    banner.setAttribute(
      "style",
      [
        "position: fixed",
        "top: 8px",
        "left: 8px",
        "right: 8px",
        "z-index: 9999",
        "padding: 8px 12px",
        "border-radius: 8px",
        "background: #b91c1c",
        "color: #fff",
        "font: 12px/1.4 system-ui, sans-serif",
      ].join(";"),
    );
    document.body.appendChild(banner);
  });
}

export {};
