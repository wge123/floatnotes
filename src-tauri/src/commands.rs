use tauri::{AppHandle, WebviewWindow};
use tauri_nspanel::ManagerExt;

use crate::menubar;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_nspanel::objc2_app_kit::{NSWindow, NSWindowSharingType};

use crate::PANEL_LABEL;

#[tauri::command]
pub fn show_panel(handle: AppHandle) {
    crate::show(&handle);
}

/// Hides whichever panel invoked it: the main panel or the menubar popover
/// (both are nonactivating panels; Esc/⌘W/the red light mean "this one").
#[tauri::command]
pub fn hide_panel(handle: AppHandle, window: WebviewWindow) {
    let panel = handle
        .get_webview_panel(window.label())
        .expect("panel not initialized");
    panel.hide();
}

#[tauri::command]
pub fn toggle_panel(handle: AppHandle) {
    crate::toggle(&handle);
}

/// Esc "unfocus" mode (step 09): keep the panel visible but resign key
/// status, handing the keyboard back to the previously active app.
#[tauri::command]
pub fn unfocus_panel(handle: AppHandle, window: WebviewWindow) {
    let panel = handle
        .get_webview_panel(window.label())
        .expect("panel not initialized");
    panel.resign_key_window();
}

/// Menubar note (ADR 0015). The popover asks this at boot to know which note
/// to open; the sidecar is the persisted truth and the frontend writes it.
#[tauri::command]
pub fn get_menubar_note(handle: AppHandle) -> Option<String> {
    handle.state::<menubar::MenuBar>().note()
}

/// Pin `id` to the menubar (tray title + popover), or clear with `None`.
/// Called by the frontend AFTER it persisted the sidecar.
#[tauri::command]
pub fn set_menubar_note(handle: AppHandle, id: Option<String>) -> Result<(), String> {
    menubar::apply(&handle, id.as_deref())
}

#[tauri::command]
pub fn quit_app(handle: AppHandle) {
    handle.exit(0);
}

/// Borrow the panel's NSWindow (macOS). The pointer from `ns_window()` is
/// valid for the window's lifetime; we only hold it for the call.
#[cfg(target_os = "macos")]
fn with_ns_window<T>(handle: &AppHandle, f: impl FnOnce(&NSWindow) -> T) -> Result<T, String> {
    let window = handle
        .get_webview_window(PANEL_LABEL)
        .ok_or("panel window missing")?;
    let ptr = window.ns_window().map_err(|e| e.to_string())?;
    // SAFETY: Tauri hands back a live NSWindow*; we only touch the sharingType
    // property (same pattern as the study clone's command.rs recipe).
    let ns_window = unsafe { &*(ptr as *const NSWindow) };
    Ok(f(ns_window))
}

/// Screen-share hiding (step 09, recipe: study clone command.rs): sharingType
/// None removes the window from screen capture/recording; ReadOnly restores
/// the default visible state.
#[tauri::command]
pub fn set_screen_share_visible(handle: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        with_ns_window(&handle, |ns_window| {
            let sharing = if visible {
                NSWindowSharingType::ReadOnly
            } else {
                NSWindowSharingType::None
            };
            ns_window.setSharingType(sharing);
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (handle, visible);
        Err("screen-share visibility is macOS-only".to_string())
    }
}

#[tauri::command]
pub fn get_screen_share_visible(handle: AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        with_ns_window(&handle, |ns_window| {
            ns_window.sharingType() != NSWindowSharingType::None
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = handle;
        Ok(true)
    }
}

/// Login item (ADR 0003): SMAppService main-app registration, macOS 13+.
/// Registration refers to the app bundle's stable path — meaningful once the
/// app lives in /Applications, harmless to toggle from a dev build.
#[tauri::command]
pub fn set_login_item(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_service_management::SMAppService;
        let service = unsafe { SMAppService::mainAppService() };
        let result = if enabled {
            unsafe { service.registerAndReturnError() }
        } else {
            unsafe { service.unregisterAndReturnError() }
        };
        result.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("login item is macOS-only".to_string())
    }
}

#[tauri::command]
pub fn get_login_item() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_service_management::{SMAppService, SMAppServiceStatus};
        let service = unsafe { SMAppService::mainAppService() };
        Ok(unsafe { service.status() } == SMAppServiceStatus::Enabled)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}
