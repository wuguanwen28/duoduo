//! duoduo 后端入口：声明各功能模块，在 `run()` 里装配插件、状态、命令、
//! 窗口事件与启动逻辑。具体实现分散在下列模块：
//! - `state`     共享状态 `PetState`
//! - `geometry`  窗口尺寸 / 缩放 / 边界 clamp
//! - `gaze`      注视采样 / 头部校准
//! - `window`    显隐 / 设置窗 / 退出 / Ctrl 轮询 / 触发动作
//! - `resources` 资源根定位与持久化 / 扫描 / manifest / 目录树
//! - `icon`      自定义图标
//! - `tray`      系统托盘

mod gaze;
mod geometry;
mod icon;
mod resources;
mod state;
mod tray;
mod window;

use std::sync::Mutex;

use tauri::{Manager, PhysicalPosition};

use state::PetState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 全局快捷键插件。具体按键由前端按用户配置经 JS 插件 API
        //（@tauri-apps/plugin-global-shortcut）注册，故此处无需 Rust 端 handler。
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(PetState {
            scale: Mutex::new(1.0),
            head_offset: Mutex::new((0.0, 0.0)),
            tray_icon: Mutex::new(None),
            pending_tab: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            gaze::pet_cursor_angle,
            gaze::pet_set_head_offset,
            geometry::pet_set_content_scale,
            window::pet_ctrl_pressed,
            window::pet_quit,
            window::pet_toggle_visibility,
            window::pet_open_settings,
            window::pet_consume_pending_tab,
            window::pet_play_action,
            resources::pet_scan_resources,
            resources::pet_read_manifest,
            resources::pet_write_manifest,
            resources::pet_set_resource_root,
            resources::pet_get_resource_root,
            resources::pet_list_dirs,
            icon::pet_save_icon,
            icon::pet_reset_icon
        ])
        .on_window_event(|window, event| {
            // Clamp the pet to the union of all monitors. There is only one
            // window now (the menu lives inside it), so this affects the
            // single "duoduo" window.
            if let tauri::WindowEvent::Moved(_) = event {
                if window.label() == "duoduo" {
                    // When the window is minimized, Windows parks it off-screen
                    // at (-32000, -32000). Clamping that back into view would
                    // fight the minimize and ping-pong Moved events forever,
                    // freezing the app — so skip clamping while minimized.
                    if window.is_minimized().unwrap_or(false) {
                        return;
                    }
                    if let Err(e) = geometry::clamp_to_work_area(window) {
                        eprintln!("clamp_to_work_area failed: {e}");
                    }
                }
            }
        })
        .setup(|app| {
            // 构建系统托盘（图标 + 菜单 + 左键显隐）。
            tray::build_tray(app.handle())?;

            // Position the pet window at the bottom-right of the primary
            // monitor's work area (clear of the taskbar). The window uses its
            // fixed size (largest cat + menu reserve); we set it explicitly here
            // so it's correct from the start regardless of the config value.
            if let Some(window) = app.get_webview_window("duoduo") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let area = monitor.work_area();
                    let sf = window.scale_factor().unwrap_or(1.0);
                    let win_size = geometry::fixed_window_size(sf);
                    let _ = window.set_size(win_size);
                    let x = area.position.x + area.size.width as i32 - win_size.width as i32;
                    let y = area.position.y + area.size.height as i32 - win_size.height as i32;
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                    // Window was created with visible:false — show it now that
                    // it's at the correct size and position (no flash).
                    let _ = window.show();
                }
            }

            // 加载自定义图标（如果用户设置过）。
            icon::load_custom_icon(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
