//! 窗口控制：显隐切换、设置窗开启/导航、退出、Ctrl 轮询、触发前端动作。

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};

use tauri::{Emitter, Manager};

use crate::icon;
use crate::state::PetState;

/// 穿透状态下窗口收不到键盘事件，故由后端主动轮询 Ctrl 是否按下。
#[tauri::command]
pub fn pet_ctrl_pressed() -> bool {
    #[cfg(target_os = "windows")]
    {
        // SAFETY: GetAsyncKeyState 只读取当前键盘状态，不持有指针或跨线程资源。
        unsafe { (GetAsyncKeyState(VK_CONTROL as i32) as u16 & 0x8000) != 0 }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Toggle the pet window: if visible and not minimized, minimize it;
/// otherwise restore (unminimize + show + focus).
pub fn toggle_pet(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("duoduo") {
        if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true) {
            let _ = window.minimize();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// Open (or focus, if already open) the settings window — a normal decorated
/// window hosting the visual manifest editor. Created lazily the first time the
/// tray "设置" item is clicked, then reused.
/// `tab` 可选，指定打开时自动切换到的标签页（如 "resources"）。
pub fn open_settings(app: &tauri::AppHandle, tab: Option<String>) {
    // 存储待导航的标签页，供前端 onMounted 时获取。
    if let Some(t) = tab {
        if let Ok(mut pending) = app.state::<PetState>().pending_tab.lock() {
            *pending = Some(t);
        }
    }
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        // 窗口已存在时，直接发送导航事件。
        if let Some(t) = app.state::<PetState>().pending_tab.lock().ok().and_then(|mut p| p.take()) {
            let _ = win.emit("navigate-to", t);
        }
        return;
    }
    // 设置窗加载独立入口 settings.html（vite 多入口构建），渲染 <SettingsApp>。
    let url = tauri::WebviewUrl::App("settings.html".into());
    // 使用 256×256 高清图标，避免任务栏显示模糊。
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
        .expect("加载窗口图标失败");

    // 恢复上次的大小（逻辑像素），无记录则用默认 800×600。
    let state = app.state::<PetState>();
    let (w, h) = state
        .settings_size
        .lock()
        .ok()
        .and_then(|g| *g)
        .unwrap_or((900.0, 600.0));

    match tauri::WebviewWindowBuilder::new(app, "settings", url)
        .title("设置")
        .inner_size(w, h)
        .min_inner_size(560.0, 420.0)
        .resizable(true)
        .center()
        .icon(icon)
        .unwrap()
        .build()
    {
        Ok(win) => {
            let _ = win.show();
            let _ = win.set_focus();
            // 如果用户设置过自定义图标，同步应用到新创建出的设置窗口。
            icon::load_custom_icon(app);
        }
        Err(e) => eprintln!("open settings window failed: {e}"),
    }
}

/// Exit the app. Mirrors the tray-icon "退出" item, exposed to the in-window
/// menu's "下班" button.
#[tauri::command]
pub fn pet_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// 切换主窗口显隐（最小化 ⇄ 恢复）。供「老板来了」全局快捷键调用，
/// 复用托盘左键的 `toggle_pet` 逻辑，因此即使窗口已被快捷键隐藏，也能
/// 在任意程序活跃时再次按键恢复——这正是全局快捷键的意义所在。
///
/// **必须声明为 `async`**：同步命令运行在主线程上，而本命令由前端
/// keydown / 全局快捷键回调经 IPC 触发，在主线程里操作/创建窗口会重入
/// 事件循环导致死锁。async 命令在独立任务线程执行，窗口操作再分派回主线程。
#[tauri::command]
pub async fn pet_toggle_visibility(app: tauri::AppHandle) {
    toggle_pet(&app);
}

/// 打开（或聚焦）设置窗口。供「打开设置」快捷键调用，复用托盘菜单的
/// `open_settings` 逻辑。`tab` 可选，指定自动切换到的标签页。
///
/// 同样**必须 `async`**：本命令由 IPC（快捷键）触发，若在主线程同步
/// `build()` 新建 webview 窗口会开启嵌套消息循环、卡死整个应用。
#[tauri::command]
pub async fn pet_open_settings(app: tauri::AppHandle, tab: Option<String>) {
    open_settings(&app, tab);
}

/// 获取并清除待导航的标签页。设置窗口 onMounted 时调用，
/// 返回打开时指定的 tab（如 "resources"），无则返回 None。
#[tauri::command]
pub fn pet_consume_pending_tab(app: tauri::AppHandle) -> Option<String> {
    app.state::<PetState>().pending_tab.lock().ok().and_then(|mut p| p.take())
}

/// Trigger a sprite animation on the frontend by emitting a "pet-play-action"
/// event with the action name. The frontend's SpriteAnimator component plays
/// the corresponding frame sequence.
#[tauri::command]
pub fn pet_play_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    app.emit("pet-play-action", action).map_err(|e| e.to_string())
}

/// 用系统默认程序打开外部链接：`http(s)` 交给浏览器、`mailto:` 交给邮件客户端。
/// 供「关于」页面的仓库地址 / 邮箱链接点击时调用（Tauri webview 默认不外跳）。
///
/// 仅放行 http / https / mailto 三种协议，避免被诱导用 `cmd start` 执行任意命令；
/// 这些 URL 目前都是前端硬编码常量，协议白名单只是额外一道保险。
#[tauri::command]
pub fn pet_open_url(url: String) -> Result<(), String> {
    let allowed =
        url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:");
    if !allowed {
        return Err("不支持的链接协议".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：避免 cmd 弹出黑框一闪而过。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // `start` 后第一个引号参数是「窗口标题」占位，必须保留空串，
        // 否则 URL 可能被误当成标题，链接打不开。
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
