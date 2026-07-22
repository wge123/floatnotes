use tauri::{AppHandle, Emitter, Manager};
use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::broadcast;

use window::WebviewWindowExt;

mod commands;
pub mod server;
pub mod store;
mod window;

/// Keeps the notes-dir watcher alive for the app's lifetime.
struct WatcherHandle(#[allow(dead_code)] std::sync::Mutex<notify::RecommendedWatcher>);

pub const PANEL_LABEL: &str = "main";
const DEFAULT_HOTKEY: &str = "alt+n";

/// Summon the panel on the monitor under the cursor.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        let _ = window.center_at_cursor_monitor();
    }
    let panel = app
        .get_webview_panel(PANEL_LABEL)
        .expect("panel not initialized");
    panel.show();
}

pub fn toggle(app: &AppHandle) {
    let panel = app
        .get_webview_panel(PANEL_LABEL)
        .expect("panel not initialized");
    if panel.is_visible() {
        panel.hide();
    } else {
        show(app);
    }
}

/// Register the global summon hotkey (ADR 0001: ⌥N is the real default;
/// FLOATNOTES_HOTKEY is the escape hatch). Registration failure must not
/// kill the app — it degrades to a visible in-panel warning instead.
fn register_hotkey(app: &AppHandle) {
    let spec = std::env::var("FLOATNOTES_HOTKEY").unwrap_or_else(|_| DEFAULT_HOTKEY.to_string());

    let result = spec
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())
        .and_then(|shortcut| {
            app.global_shortcut()
                .register(shortcut)
                .map_err(|e| e.to_string())
        });

    if let Err(err) = result {
        let message = format!("Global hotkey \"{spec}\" could not be registered: {err}");
        eprintln!("[floatnotes] {message}");
        let _ = app.emit("floatnotes://hotkey-warning", message);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_nspanel::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::show_panel,
            commands::hide_panel,
            commands::toggle_panel,
            commands::quit_app
        ])
        .setup(|app| {
            // No Dock icon, no app switcher entry — the panel is the app.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window(PANEL_LABEL)
                .expect("main window missing from tauri.conf.json");
            window.to_floatnotes_panel()?;
            let _ = window.center_at_cursor_monitor();

            let panel = app
                .get_webview_panel(PANEL_LABEL)
                .expect("panel conversion did not register the panel");
            panel.show();

            register_hotkey(app.app_handle());

            // Notes store + localhost server + watcher (contract: S03).
            let note_store = store::NoteStore::open_default()?;
            let (tx, _rx) = broadcast::channel::<server::Event>(64);
            let watcher = server::spawn_watcher(note_store.dir().to_path_buf(), tx.clone())?;
            app.manage(WatcherHandle(std::sync::Mutex::new(watcher)));
            let handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = server::serve(note_store, tx).await {
                    // Fail loud: log + surface in the panel (no silent
                    // fallback port), but don't kill the running app.
                    let message = format!("FloatNotes server failed: {err}");
                    eprintln!("[floatnotes] {message}");
                    let _ = handle.emit("floatnotes://server-error", message);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Reactivation (Finder/Spotlight) with no visible windows re-shows
            // the panel — the non-hotkey way back in.
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    show(app);
                }
            }
        });
}
