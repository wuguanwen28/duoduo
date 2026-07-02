//! 系统托盘：图标 + 菜单（设置 / 退出）+ 左键显隐切换。

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::state::PetState;
use crate::window::{open_settings, toggle_pet};

/// 构建系统托盘并把托盘 id 存入 `PetState`（供后续动态换图标）。
/// 在 `setup` 阶段调用一次。
pub fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    // 托盘菜单：设置（打开菜单面板）/ 意见反馈 / 退出。
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let feedback = MenuItem::with_id(app, "feedback", "意见反馈", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &feedback, &quit])?;

    // 托盘使用 32×32 图标，系统托盘区本身就是小尺寸。
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .expect("加载托盘图标失败");
    let tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        // 左键点击托盘图标 → 最小化/恢复来回切换；右键显示菜单。
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => open_settings(app, None),
            "feedback" => {
                open_settings(app, Some("update".into()));
                // 设置窗已存在时 open_settings 会发 navigate-to；再额外提示打开反馈弹窗。
                let _ = app.emit("open-feedback", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_pet(tray.app_handle());
            }
        })
        .build(app)?;

    // 保存托盘引用，供后续动态修改图标。
    if let Ok(mut guard) = app.state::<PetState>().tray_icon.lock() {
        *guard = Some(tray.id().clone());
    }
    Ok(())
}
