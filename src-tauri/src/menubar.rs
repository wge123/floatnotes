//! Menu bar note (ADR 0015): one note can be pinned to the menubar. Its
//! title sits next to the tray icon and a left-click on the icon drops a
//! popover panel with that note right under it. Right-click keeps the menu.
//!
//! Ownership: the sidecar's `menuBarNote` is the truth and the FRONTEND is
//! its only writer (it already PUTs the sidecar as a whole value, so a second
//! writer here would race it). Rust reads it once at boot and is told about
//! later changes through `set_menubar_note`. The tray title follows the note
//! on disk: a rename re-titles it, a delete blanks it, a restore brings it
//! back, all off the server's broadcast channel, no second watcher.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};
use tauri_nspanel::{tauri_panel, ManagerExt};
use tokio::sync::broadcast;

use crate::server::Event;
use crate::store::NoteStore;
use crate::window::WebviewWindowExt;

pub const MENUBAR_LABEL: &str = "menubar";
pub const TRAY_ID: &str = "floatnotes-tray";
/// Emitted to the popover when the pinned note changes while it is alive.
pub const NOTE_EVENT: &str = "floatnotes://menubar-note";

const POPOVER_WIDTH: f64 = 420.0;
const POPOVER_HEIGHT: f64 = 520.0;
/// Gap between the menubar and the popover's top edge, logical px.
const POPOVER_GAP: f64 = 6.0;
/// Menubar real estate is shared; long titles get an ellipsis.
const TITLE_MAX_CHARS: usize = 28;
/// A tray click that lands right after the popover lost key status is the
/// click that MADE it lose key status: the mouse-down on the icon resigns the
/// panel (which hides it) before the click event arrives, and without this
/// window the click would re-open what the user just closed.
const DISMISS_DEBOUNCE: Duration = Duration::from_millis(400);

/// Store-local state: which note is in the menubar right now.
#[derive(Default)]
pub struct MenuBar {
    note: Mutex<Option<String>>,
    last_dismiss: Mutex<Option<Instant>>,
}

impl MenuBar {
    pub fn note(&self) -> Option<String> {
        self.note.lock().expect("menubar lock").clone()
    }
}

tauri_panel! {
    panel_event!(PopoverDelegate {
        windowDidResignKey(notification: &NSNotification) -> ()
    })
}

/// Truncate a note title for the space next to the tray icon.
pub fn tray_title(title: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        return "Untitled".to_string();
    }
    let mut chars = title.chars();
    let head: String = chars.by_ref().take(TITLE_MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn tray(app: &AppHandle) -> Option<TrayIcon> {
    app.tray_by_id(TRAY_ID)
}

/// `TrayIcon::set_title(None)` is a no-op on macOS (tray-icon only calls
/// `setTitle:` for `Some`), so clearing the title means setting it empty.
/// Measured: a deleted note kept its title in the menubar until this.
fn set_tray_title(tray: &TrayIcon, title: Option<&str>) -> tauri::Result<()> {
    tray.set_title(Some(title.map(tray_title).unwrap_or_default()))
}

/// Pin `note` (id) to the menubar, or clear it with `None`. The title is
/// resolved from disk here so the caller cannot pin a stale one.
pub fn apply(app: &AppHandle, note: Option<&str>) -> Result<(), String> {
    let store = app.state::<NoteStore>();
    let title = match note {
        Some(id) => Some(store.read(id).map_err(|e| e.to_string())?.title),
        None => None,
    };
    *app.state::<MenuBar>().note.lock().expect("menubar lock") = note.map(str::to_string);

    let Some(tray) = tray(app) else {
        return Err("tray icon missing".to_string());
    };
    set_tray_title(&tray, title.as_deref()).map_err(|e| e.to_string())?;
    // With a note pinned, left-click is the popover and the menu moves to
    // right-click; with none, left-click stays the menu (the only always-on
    // way back to the panel, see build_tray).
    tray.set_show_menu_on_left_click(note.is_none())
        .map_err(|e| e.to_string())?;

    if let Some(popover) = app.get_webview_window(MENUBAR_LABEL) {
        match note {
            Some(id) => {
                let _ = popover.emit_to(MENUBAR_LABEL, NOTE_EVENT, id);
            }
            None => {
                if let Ok(panel) = app.get_webview_panel(MENUBAR_LABEL) {
                    panel.hide();
                }
            }
        }
    }
    Ok(())
}

/// Boot: the sidecar remembers the pin across launches. A pin whose note is
/// gone is not an error: the tray simply comes up without a title.
pub fn restore(app: &AppHandle, store: &NoteStore) {
    let pinned = match store.sidecar_load() {
        Ok(sidecar) => sidecar.menu_bar_note,
        Err(err) => {
            eprintln!("[floatnotes] menubar: sidecar unreadable at boot: {err}");
            None
        }
    };
    if let Some(id) = pinned {
        if let Err(err) = apply(app, Some(&id)) {
            eprintln!("[floatnotes] menubar: could not restore pin {id}: {err}");
            let _ = apply(app, None);
        }
    }
}

/// Keep the tray title in step with the note on disk (rename / delete /
/// restore), off the same broadcast the WebSocket clients get.
pub fn follow_title(app: AppHandle, tx: &broadcast::Sender<Event>) {
    let mut rx = tx.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let pinned = app.state::<MenuBar>().note();
                    let Some(id) = pinned else { continue };
                    // Reindex carries no id but can hide a rename we missed.
                    if event.kind != "notes-reindexed" && event.id != id {
                        continue;
                    }
                    let Some(tray) = tray(&app) else { continue };
                    let title = app.state::<NoteStore>().read(&id).ok().map(|n| n.title);
                    if let Err(err) = set_tray_title(&tray, title.as_deref()) {
                        eprintln!("[floatnotes] menubar: could not update tray title: {err}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Tray handler: a left-click with a note pinned toggles the popover. Every
/// other event is the menu's business (Tauri shows it itself).
pub fn on_tray_event(tray: &TrayIcon, event: TrayIconEvent) {
    let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        rect,
        position,
        ..
    } = event
    else {
        return;
    };
    let app = tray.app_handle();
    if app.state::<MenuBar>().note().is_none() {
        return;
    }
    if let Err(err) = toggle_popover(app, rect, position) {
        eprintln!("[floatnotes] menubar: popover failed: {err}");
    }
}

fn toggle_popover(
    app: &AppHandle,
    rect: tauri::Rect,
    click: PhysicalPosition<f64>,
) -> tauri::Result<()> {
    if let Ok(panel) = app.get_webview_panel(MENUBAR_LABEL) {
        if panel.is_visible() {
            panel.hide();
            return Ok(());
        }
    }
    let recently_dismissed = app
        .state::<MenuBar>()
        .last_dismiss
        .lock()
        .expect("menubar lock")
        .is_some_and(|at| at.elapsed() < DISMISS_DEBOUNCE);
    if recently_dismissed {
        return Ok(());
    }

    let window = match app.get_webview_window(MENUBAR_LABEL) {
        Some(window) => window,
        None => build_popover(app)?,
    };

    // Under the icon, horizontally centred on it, kept inside the icon's
    // monitor. Tray coordinates arrive top-left-origin physical (tray-icon
    // flips AppKit's bottom-left origin for us).
    let scale = window.scale_factor()?;
    let icon_pos = rect.position.to_physical::<f64>(scale);
    let icon_size = rect.size.to_physical::<f64>(scale);
    let win_size = window.outer_size()?;
    let mut x = icon_pos.x + icon_size.width / 2.0 - win_size.width as f64 / 2.0;
    let y = icon_pos.y + icon_size.height + POPOVER_GAP * scale;
    if let Some(monitor) = app.monitor_from_point(click.x, click.y)? {
        let left = monitor.position().x as f64;
        let right = left + monitor.size().width as f64 - win_size.width as f64;
        x = x.clamp(left, right.max(left));
    }
    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;

    let panel = app
        .get_webview_panel(MENUBAR_LABEL)
        .expect("popover converted to a panel on build");
    // Key, not just front: a popover that never becomes key never resigns
    // it, and resigning key is what dismisses it on a click elsewhere.
    panel.show_and_make_key();
    Ok(())
}

/// Lazily build the popover: same app, same nonactivating panel recipe as
/// the main window, plus dismiss-on-resign-key. Built once, then hidden and
/// re-shown like the main panel (a hidden window keeps its editor state).
fn build_popover(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, MENUBAR_LABEL, WebviewUrl::default())
        .title("FloatNotes")
        .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
        .min_inner_size(360.0, 240.0)
        .decorations(false)
        .transparent(true)
        .visible(false)
        .accept_first_mouse(true)
        .build()?;
    let panel = window.to_floatnotes_panel()?;

    let delegate = PopoverDelegate::new();
    let resign_handle = app.clone();
    delegate.window_did_resign_key(move |_notification| {
        if let Ok(panel) = resign_handle.get_webview_panel(MENUBAR_LABEL) {
            panel.hide();
        }
        *resign_handle
            .state::<MenuBar>()
            .last_dismiss
            .lock()
            .expect("menubar lock") = Some(Instant::now());
    });
    // The panel retains the delegate (set_event_handler), so dropping our
    // handle here is fine.
    panel.set_event_handler(Some(delegate.as_protocol_object()));

    let close_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Ok(panel) = close_handle.get_webview_panel(MENUBAR_LABEL) {
                panel.hide();
            }
        }
    });
    Ok(window)
}

#[cfg(test)]
mod tests {
    use super::tray_title;

    #[test]
    fn tray_title_keeps_short_titles_and_ellipsizes_long_ones() {
        assert_eq!(tray_title("Groceries"), "Groceries");
        assert_eq!(tray_title("  "), "Untitled");
        let exact = "b".repeat(28);
        assert_eq!(tray_title(&exact), exact);
        let shown = tray_title(&"a".repeat(40));
        assert_eq!(shown.chars().count(), 29);
        assert!(shown.ends_with('…'));
    }
}
