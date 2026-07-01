use std::sync::Mutex;

/// 下载状态快照，供设置窗口重开时恢复，也供小猫窗口判断是否要提示安装。
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadState {
    pub is_downloading: bool,
    pub download_id: u64,
    pub progress: u8,
    pub downloaded_path: Option<String>,
    pub latest_version: Option<String>,
}

/// Shared app state. `scale` mirrors the in-window size slider so the gaze and
/// clamp logic know the cat's real on-screen size. The window itself is now
/// **dynamic** — `geometry::window_size_for` sizes it for the current cat plus
/// menu/bubble reserves, and `pet_set_content_scale` re-anchors it to the cat
/// foot whenever the slider moves (the sprite no longer just scales inside a
/// fixed box).
///
/// `head_offset` stores the ratio of the head-centre offset to the sprite
/// diameter, calibrated by the user so the dead-zone tracks the actual head.
///
/// `pending_tab` stores the tab to navigate to when settings window opens.
///
/// `settings_size` stores the last logical size (width, height) of the settings
/// window so it can be restored on reopen.
///
/// `download` 持久化更新下载状态，使设置窗口关闭后仍可后台下载，重开后恢复。
pub struct PetState {
    pub scale: Mutex<f64>,
    pub head_offset: Mutex<(f64, f64)>,
    pub tray_icon: Mutex<Option<tauri::tray::TrayIconId>>,
    pub pending_tab: Mutex<Option<String>>,
    pub settings_size: Mutex<Option<(f64, f64)>>,
    pub download: Mutex<DownloadState>,
}
