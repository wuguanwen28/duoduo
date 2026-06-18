use std::sync::Mutex;

/// Shared app state. `scale` mirrors the in-window size slider so the gaze and
/// clamp logic know the cat's real on-screen size (the window itself is a fixed
/// box sized for the largest cat + menu — see `geometry::fixed_window_size`; the
/// sprite scales inside it without resizing the window).
///
/// `head_offset` stores the ratio of the head-centre offset to the sprite
/// diameter, calibrated by the user so the dead-zone tracks the actual head.
///
/// `pending_tab` stores the tab to navigate to when settings window opens.
///
/// `settings_size` stores the last logical size (width, height) of the settings
/// window so it can be restored on reopen.
pub struct PetState {
    pub scale: Mutex<f64>,
    pub head_offset: Mutex<(f64, f64)>,
    pub tray_icon: Mutex<Option<tauri::tray::TrayIconId>>,
    pub pending_tab: Mutex<Option<String>>,
    pub settings_size: Mutex<Option<(f64, f64)>>,
}
