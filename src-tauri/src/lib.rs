use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::broadcast;

use window::WebviewWindowExt;

mod commands;
mod menubar;
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

/// Menubar icon: the permanent way back to the panel. The hotkey is a
/// registration that can fail and the panel itself can be hidden, so without
/// this an Accessory-policy app has no discoverable entry point at all.
/// With a note pinned to the menubar (menubar.rs) left-click becomes that
/// note's popover and the menu moves to right-click.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show panel", true, Some("Alt+N"))?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide panel", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit FloatNotes", true, Some("Cmd+Q"))?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &hide_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    TrayIconBuilder::with_id(menubar::TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("bundled icon"))
        // NOT a template: the bundled icon is the full-colour app icon, and
        // template rendering collapses it to a filled silhouette that reads as
        // a blank square in the menubar. A real monochrome glyph could go back
        // to template rendering.
        .icon_as_template(false)
        .menu(&menu)
        // Left-click is the menu, not a toggle: a toggle would make the only
        // always-available control the one that can hide the panel by accident.
        .show_menu_on_left_click(true)
        .on_tray_icon_event(menubar::on_tray_event)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show(app),
            "hide" => {
                if let Ok(panel) = app.get_webview_panel(PANEL_LABEL) {
                    panel.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
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
            commands::unfocus_panel,
            commands::quit_app,
            commands::set_screen_share_visible,
            commands::get_screen_share_visible,
            commands::set_login_item,
            commands::get_login_item,
            commands::get_menubar_note,
            commands::set_menubar_note
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

            // The red traffic light hides, never destroys: the activation
            // policy is Accessory, so a closed window would leave a running
            // app with no window, no Dock tile and no way back except ⌥N.
            let close_handle = app.app_handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Ok(panel) = close_handle.get_webview_panel(PANEL_LABEL) {
                        panel.hide();
                    }
                }
            });

            register_hotkey(app.app_handle());
            build_tray(app.app_handle())?;

            // Notes store + localhost server + watcher (contract: S03).
            let note_store = store::NoteStore::open_default()?;
            let (tx, _rx) = broadcast::channel::<server::Event>(64);

            // Menubar note (ADR 0015): the store is shared with the tray so
            // titles resolve from disk; the pin itself is restored from the
            // sidecar and then follows the note through the broadcast.
            app.manage(note_store.clone());
            app.manage(menubar::MenuBar::default());
            menubar::restore(app.app_handle(), &note_store);
            menubar::follow_title(app.app_handle().clone(), &tx);
            // A watcher that dies takes live sync with it, so route its death
            // to the same in-panel banner the server errors use.
            let watcher_handle = app.app_handle().clone();
            let watcher = server::spawn_watcher(
                note_store.dir().to_path_buf(),
                tx.clone(),
                move |message| {
                    eprintln!("[floatnotes] {message}");
                    let _ = watcher_handle.emit("floatnotes://server-error", message);
                },
            )?;
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
