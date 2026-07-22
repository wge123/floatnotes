use tauri::AppHandle;
use tauri_nspanel::ManagerExt;

use crate::PANEL_LABEL;

#[tauri::command]
pub fn show_panel(handle: AppHandle) {
    crate::show(&handle);
}

#[tauri::command]
pub fn hide_panel(handle: AppHandle) {
    let panel = handle
        .get_webview_panel(PANEL_LABEL)
        .expect("panel not initialized");
    panel.hide();
}

#[tauri::command]
pub fn toggle_panel(handle: AppHandle) {
    crate::toggle(&handle);
}

#[tauri::command]
pub fn quit_app(handle: AppHandle) {
    handle.exit(0);
}
