//! 自定义应用/托盘图标：保存（base64）、恢复默认、启动时加载。

use std::path::PathBuf;

use tauri::Manager;

use crate::resources::resource_root;
use crate::state::PetState;

/// 自定义图标的保存路径（资源根下）。
fn icon_path(app: &tauri::AppHandle) -> PathBuf {
    let root = resource_root(app);
    root.join("app-icon.png")
}

/// 从 base64 数据保存自定义图标并更新窗口和托盘图标。
#[tauri::command]
pub fn pet_save_icon(app: tauri::AppHandle, data: String) -> Result<(), String> {
    // 解析 base64 数据（支持 data:image/png;base64,... 格式）。
    let base64_str = data
        .split(',')
        .nth(1)
        .unwrap_or(&data);
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        base64_str,
    )
    .map_err(|e| format!("base64 解码失败：{e}"))?;

    // 保存到文件。
    let path = icon_path(&app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("保存图标失败：{e}"))?;

    // 转为 Image 并设置到窗口和托盘。
    let image = tauri::image::Image::from_bytes(&bytes)
        .map_err(|e| format!("解析图标失败：{e}"))?;

    // 更新所有窗口图标。
    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(image.clone());
    }

    // 更新托盘图标。
    let state = app.state::<PetState>();
    if let Ok(guard) = state.tray_icon.lock() {
        if let Some(id) = &*guard {
            if let Some(tray) = app.tray_by_id(id) {
                let _ = tray.set_icon(Some(image.clone()));
            }
        }
    }

    Ok(())
}

/// 删除自定义图标，恢复默认。
#[tauri::command]
pub fn pet_reset_icon(app: tauri::AppHandle) -> Result<(), String> {
    let path = icon_path(&app);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    // 恢复默认图标。
    let default_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
        .expect("加载默认图标失败");
    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(default_icon.clone());
    }

    let default_tray = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .expect("加载默认托盘图标失败");
    let state = app.state::<PetState>();
    if let Ok(guard) = state.tray_icon.lock() {
        if let Some(id) = &*guard {
            if let Some(tray) = app.tray_by_id(id) {
                let _ = tray.set_icon(Some(default_tray));
            }
        }
    }

    Ok(())
}

/// 加载自定义图标（如果存在）。
pub fn load_custom_icon(app: &tauri::AppHandle) {
    let path = icon_path(app);
    if !path.exists() {
        return;
    }
    let Ok(bytes) = std::fs::read(&path) else { return };
    let Ok(image) = tauri::image::Image::from_bytes(&bytes) else { return };

    // 更新所有窗口图标。
    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(image.clone());
    }

    // 更新托盘图标。先把托盘 id 从锁里克隆出来并立刻释放锁，避免 `if let`
    // 条件里的 MutexGuard 临时值在函数尾部才析构、从而比 `state` 活得更久。
    let state = app.state::<PetState>();
    let tray_id = state.tray_icon.lock().ok().and_then(|g| g.clone());
    if let Some(id) = tray_id {
        if let Some(tray) = app.tray_by_id(&id) {
            let _ = tray.set_icon(Some(image));
        }
    }
}
