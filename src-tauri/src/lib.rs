//! duoduo 后端入口：声明各功能模块，在 `run()` 里装配插件、状态、命令、
//! 窗口事件与启动逻辑。具体实现分散在下列模块：
//! - `state`     共享状态 `PetState`
//! - `geometry`  窗口尺寸 / 缩放 / 边界 clamp
//! - `gaze`      注视采样 / 头部校准
//! - `window`    显隐 / 设置窗 / 退出 / Ctrl 轮询 / 触发动作
//! - `resources` 资源根定位与持久化 / 扫描 / manifest / 目录树
//! - `icon`      自定义图标
//! - `tray`      系统托盘
//! - `feedback`  用户反馈提交

mod converter;
mod config;
mod feedback;
mod gaze;
mod geometry;
mod icon;
mod resources;
mod settings;
mod state;
mod tray;
mod updater;
mod window;

use std::sync::Mutex;

use tauri::Manager;

use state::{DownloadState, PetState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 全局快捷键插件。具体按键由前端按用户配置经 JS 插件 API
        //（@tauri-apps/plugin-global-shortcut）注册，故此处无需 Rust 端 handler。
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    // 单实例锁：第二个实例启动时聚焦主窗，而非新开进程。
    // 多猫=单进程多窗口，仍禁止开第二个应用进程。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("settings") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    builder
        .manage(PetState {
            scale: Mutex::new(1.0),
            head_offset: Mutex::new((0.0, 0.0)),
            tray_icon: Mutex::new(None),
            pending_tab: Mutex::new(None),
            settings_size: Mutex::new(None),
            download: Mutex::new(DownloadState::default()),
            last_check: Mutex::new(None),
            last_checked_at: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            gaze::pet_cursor_angle,
            gaze::pet_set_head_offset,
            geometry::pet_set_content_scale,
            window::pet_ctrl_pressed,
            window::pet_quit,
            window::pet_toggle_visibility,
            window::pet_toggle_cat_visible,
            window::pet_open_settings,
            window::pet_show_cat_window,
            window::pet_close_cat_window,
            window::pet_list_shown_cats,
            window::pet_list_visible_cats,
            window::pet_consume_pending_tab,
            window::pet_play_action,
            window::pet_open_url,
            resources::pet_scan_resources,
            resources::pet_read_manifest,
            resources::pet_write_manifest,
            resources::pet_set_resource_root,
            resources::pet_list_dirs,
            converter::pet_converter_begin,
            converter::pet_converter_write,
            icon::pet_save_icon,
            icon::pet_reset_icon,
            updater::pet_app_version,
            updater::pet_update_check,
            updater::pet_update_download,
            updater::pet_update_cancel,
            updater::pet_update_status,
            updater::pet_update_apply,
            updater::pet_update_last_result,
            feedback::pet_submit_feedback,
            settings::pet_settings_exists,
            settings::pet_load_global,
            settings::pet_save_global,
            settings::pet_load_cat,
            settings::pet_save_cat,
            settings::pet_delete_cat,
            settings::pet_list_cats,
            settings::pet_save_avatar,
            settings::pet_avatar_url,
            settings::pet_reset_avatar,
            settings::pet_apply_avatar_as_icon,
            settings::pet_ensure_default_avatar
        ])
        .on_window_event(|window, event| {
            // settings 主窗关闭(×)=隐藏到托盘（托盘「退出」才真退）。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
            }
            // 宠物窗 Moved：clamp 到工作区。最小化时 Windows 把窗口停到
            // (-32000,-32000)，clamp 会与最小化打架、ping-pong 到卡死，故跳过。
            if let tauri::WindowEvent::Moved(_) = event {
                if window.label().starts_with("cat-") {
                    if window.is_minimized().unwrap_or(false) {
                        return;
                    }
                    if let Err(e) = geometry::clamp_to_work_area(window) {
                        eprintln!("clamp_to_work_area failed: {e}");
                    }
                }
            }
            // settings 窗 Resized：记忆逻辑尺寸，重开恢复。
            if let tauri::WindowEvent::Resized(size) = event {
                if window.label() == "settings" {
                    let sf = window.scale_factor().unwrap_or(1.0);
                    let logical = size.to_logical::<f64>(sf);
                    if let Ok(mut guard) =
                        window.app_handle().state::<PetState>().settings_size.lock()
                    {
                        *guard = Some((logical.width, logical.height));
                    }
                }
            }
            // 宠物窗销毁（下班/关窗）：广播让设置页实时刷新上班/下班、显隐状态。
            if let tauri::WindowEvent::Destroyed = event {
                if window.label().starts_with("cat-") {
                    use tauri::Emitter;
                    let _ = window.app_handle().emit("cat-windows-changed", ());
                    // 通知其余存活猫窗重新登记全局快捷键：全局键是进程级资源，
                    // 关掉的这只猫可能正是当前持有者，存活猫需重新抢注，否则快捷键失效。
                    let _ = window.app_handle().emit("cat-window-destroyed", ());
                }
            }
        })
        .setup(|app| {
            // 构建系统托盘（图标 + 菜单 + 左键显隐）。
            tray::build_tray(app.handle())?;

            // 给设置主窗设置高清默认图标（256×256），避免任务栏/标题栏图标模糊。
            // 若用户设过自定义图标，下面的 load_custom_icon 会再覆盖。
            if let Some(win) = app.get_webview_window("settings") {
                if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/128x128@2x.png"
                )) {
                    let _ = win.set_icon(img);
                }
            }

            // 默认宠物窗由设置页主窗 mount 后通过 pet_show_cat_window 创建，
            // 避免在 setup 同步 build webview 卡死。

            // 加载自定义图标（如果用户设置过）。
            icon::load_custom_icon(app.handle());

            // 清理上次热更新残留的旧 exe。
            updater::cleanup_old_exe();

            // 后台定时轮询检查更新：与任何窗口的开关无关，进程存活期间持续运行，
            // 立即查一次后每 4 小时重查（见 updater::spawn_update_polling）。
            updater::spawn_update_polling(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
