use std::sync::Arc;

use tauri::{Manager, PhysicalPosition, Runtime, WebviewWindow};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, Panel, PanelLevel, StyleMask, TrackingAreaOptions,
    WebviewWindowExt as PanelWebviewWindowExt,
};
use thiserror::Error;

type TauriError = tauri::Error;

// The load-bearing native recipe (ported from the study clone's window.rs):
// nonactivating_panel + PanelLevel::Floating + can_join_all_spaces +
// full_screen_auxiliary + ActivationPolicy::Accessory + macOSPrivateApi turns
// the stock Tauri window into a Raycast-style always-on-top, every-Space,
// keystroke-accepting float.
tauri_panel! {
    panel!(FloatNotesPanel {
        config: {
            canBecomeKeyWindow: true,
            canBecomeMainWindow: false,
            isFloatingPanel: true
        }
        with: {
            tracking_area: {
                options: TrackingAreaOptions::new()
                    .active_always()
                    .mouse_entered_and_exited()
                    .mouse_moved()
                    .cursor_update(),
                auto_resize: true
            }
        }
    })
}

#[derive(Error, Debug)]
enum Error {
    #[error("Unable to convert window to panel")]
    Panel,
}

pub trait WebviewWindowExt {
    fn to_floatnotes_panel(&self) -> tauri::Result<Arc<dyn Panel>>;

    fn center_at_cursor_monitor(&self) -> tauri::Result<()>;
}

impl<R: Runtime> WebviewWindowExt for WebviewWindow<R> {
    fn to_floatnotes_panel(&self) -> tauri::Result<Arc<dyn Panel>> {
        let panel = self
            .to_panel::<FloatNotesPanel>()
            .map_err(|_| TauriError::Anyhow(Error::Panel.into()))?;

        panel.set_level(PanelLevel::Floating.value());

        panel.set_collection_behavior(
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces()
                .into(),
        );

        panel.set_style_mask(StyleMask::empty().nonactivating_panel().resizable().into());

        Ok(panel)
    }

    /// Center the window on the monitor currently under the cursor, so the
    /// hotkey summons the panel where the user is working.
    fn center_at_cursor_monitor(&self) -> tauri::Result<()> {
        let cursor = self.cursor_position()?;
        if let Some(monitor) = self
            .app_handle()
            .monitor_from_point(cursor.x, cursor.y)?
        {
            let win_size = self.outer_size()?;
            let x = monitor.position().x
                + ((monitor.size().width as i32 - win_size.width as i32) / 2);
            let y = monitor.position().y
                + ((monitor.size().height as i32 - win_size.height as i32) / 2);
            self.set_position(PhysicalPosition::new(x, y))?;
        }

        Ok(())
    }
}
