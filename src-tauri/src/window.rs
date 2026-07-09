//! 窗口控制：设置页主窗显隐、宠物窗创建/销毁、退出、Ctrl 轮询、触发前端动作。
//!
//! 窗口模型：
//! - `settings`：主窗（tauri.conf.json 定义，装饰窗口），关闭(×)=隐藏到托盘。
//! - `cat-<id>`：每只猫一个宠物窗（动态创建，透明无边框置顶），关闭=销毁。

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};

use tauri::{Emitter, Manager, PhysicalPosition};

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

/// 切换设置页主窗显隐（托盘左键用）：可见则最小化，否则恢复。
pub fn toggle_settings(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(true) {
            let _ = win.minimize();
        } else {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// 「老板来了」：统一切换所有宠物窗显隐。
///
/// **不是逐窗取反**——而是先看全局：只要有**任一** cat-* 窗当前在显示（可见且未最小化），
/// 就把**全部**藏起来；只有当所有窗都已隐藏时，才把全部恢复显示。
/// 这样「一显一隐」时不会逐窗取反导致状态错乱。
pub fn toggle_pet(app: &tauri::AppHandle) {
    let cat_wins: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("cat-"))
        .map(|(_, win)| win)
        .collect();
    // 有任一「可见且未最小化」→ 全部藏；否则（全已隐藏）→ 全部显示。
    let any_shown = cat_wins
        .iter()
        .any(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(true));
    for win in &cat_wins {
        if any_shown {
            let _ = win.minimize();
        } else {
            let _ = win.unminimize();
            let _ = win.show();
        }
    }
}

/// 显示某只猫的宠物窗口：已有则 show/聚焦，否则创建并定位到当前显示器右下角。
pub fn show_cat_window(app: &tauri::AppHandle, cat_id: &str) {
    let label = format!("cat-{cat_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    // 创建宠物窗（透明、无边框、置顶、跳过任务栏）。先隐藏，定位后再 show 避免闪现。
    // catId 从窗口 label（cat-<id>）解析，故 URL 不带 query。
    //
    // 建窗即用该猫配置里的 size 算尺寸，而非硬编码 1.0：否则窗口 show 后会被前端
    // `watch(size, immediate)` 触发的 `pet_set_content_scale` 再次 resize + 移位，
    // 表现为猫「出来 → 消失一下 → 再出现」。同步把 scale 缓存写对，使 gaze/clamp
    // 在前端 watch 触发前就按正确尺寸计算。
    let cat = crate::settings::load_cat(app, cat_id);
    let scale = cat
        .display
        .size
        .clamp(0.1, crate::geometry::PET_MAX_SCALE);
    if let Ok(mut g) = app.state::<PetState>().scale.lock() {
        *g = scale;
    }
    // 创建前已存在的 cat 窗数：首次无记忆位置时按此往左错开，避免与已有的重合。
    let existing_cats = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("cat-"))
        .count() as i32;
    let url = tauri::WebviewUrl::App("index.html".into());
    match tauri::WebviewWindowBuilder::new(app, &label, url)
        .title("duoduo")
        .inner_size(620.0, 400.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .build()
    {
        Ok(win) => {
            // 按当前缩放定尺寸 + 定位到主显示器工作区右下角。
            if let Ok(Some(monitor)) = win.current_monitor() {
                let area = monitor.work_area();
                let sf = win.scale_factor().unwrap_or(1.0);
                let win_size = crate::geometry::window_size_for(scale, sf);
                let _ = win.set_size(win_size);
                // 猫精灵物理直径（精灵在窗口内水平居中、贴底）。错开步长用它 + 小间隙，
                // 而非整窗宽——窗口比精灵宽（左右各预留 MENU_SIDE_RESERVE 给菜单/气泡），
                // 按整窗宽错开会让两只猫隔着一整块透明区，看着离得很远。
                let cat_px = (crate::geometry::PET_BASE_PX * scale * sf).round() as i32;
                let step = cat_px + (8.0 * sf).round() as i32; // 精灵直径 + 8 逻辑像素间隙
                // 记忆位置优先；无则以右下角为基准、按已存在猫数往左错开一个身位。
                let base_x = area.position.x + area.size.width as i32 - win_size.width as i32;
                let base_y = area.position.y + area.size.height as i32 - win_size.height as i32;
                let (mut x, mut y) = match cat.window_pos {
                    Some(p) => (p.x, p.y),
                    None => (base_x - existing_cats * step, base_y),
                };
                // clamp 到工作区，避免记忆位置落在屏外、或错开出界。
                x = x.clamp(area.position.x, base_x);
                y = y.clamp(area.position.y, base_y);
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
            let _ = win.show();
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("show_cat_window build failed: {e}"),
    }
}

/// 打开（或聚焦）设置页主窗。`tab` 可选，指定打开时切换到的标签页；
/// `cat_id` 可选，指定要激活（写入 activeCatId）的猫——从宠物窗菜单/按钮等带猫
/// 上下文的入口打开时传入，使设置页默认编辑那只猫；托盘/快捷键打开不传，保持原激活。
///
/// **必须 `async`**：由 IPC（快捷键）触发，主线程同步操作窗口会重入事件循环死锁。
#[tauri::command]
pub async fn pet_open_settings(
    app: tauri::AppHandle,
    tab: Option<String>,
    cat_id: Option<String>,
) {
    open_settings(&app, tab, cat_id);
}

/// 设置页主窗已由 tauri.conf.json 创建；此处只 show/聚焦 + 发导航事件。
pub fn open_settings(app: &tauri::AppHandle, tab: Option<String>, cat_id: Option<String>) {
    // 指定猫 id 时先持久化为 activeCatId，使设置页加载时默认编辑/激活这只猫。
    if let Some(id) = cat_id {
        let mut g = crate::settings::load_global(app);
        if g.active_cat_id != id {
            g.active_cat_id = id;
            let _ = crate::settings::save_global(app, &g);
        }
    }
    if let Some(t) = tab {
        if let Ok(mut pending) = app.state::<PetState>().pending_tab.lock() {
            *pending = Some(t);
        }
    }
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        // 设置窗是预创建单例，JS 启动只加载一次配置；每次打开时通知它重载，
        // 以应用最新的 activeCatId（从宠物窗打开设置页时会改 activeCatId 激活那只猫）。
        let _ = win.emit("settings-activated", ());
        // 窗口已存在时，直接发送导航事件。
        if let Some(t) = app
            .state::<PetState>()
            .pending_tab
            .lock()
            .ok()
            .and_then(|mut p| p.take())
        {
            let _ = win.emit("navigate-to", t);
        }
    }
}

/// 显示某只猫的宠物窗口（供前端「显示窗口」按钮调用）。
#[tauri::command]
pub async fn pet_show_cat_window(app: tauri::AppHandle, cat_id: String) {
    show_cat_window(&app, &cat_id);
    // 广播让设置页实时刷新上班/显隐状态。
    let _ = app.emit("cat-windows-changed", ());
}

/// 关闭某只猫的宠物窗口（删除猫时调用，避免僵尸宠物窗）。
/// cat 窗 CloseRequested 不 prevent，close() 即销毁。窗口不存在则无操作。
#[tauri::command]
pub async fn pet_close_cat_window(app: tauri::AppHandle, cat_id: String) {
    if let Some(win) = app.get_webview_window(&format!("cat-{cat_id}")) {
        let _ = win.close();
    }
}

/// 列出当前「上班中」的猫 id：只要该猫宠物窗**存在**（已创建、未销毁）就算上班。
///
/// 判定标准是「窗口在不在」而非「可见/最小化」——「老板来了」只是把窗最小化/隐藏、
/// 窗口仍在，故仍算上班（躲着而已）；只有「下班」把窗 close 销毁后才算真正下班。
#[tauri::command]
pub fn pet_list_shown_cats(app: tauri::AppHandle) -> Vec<String> {
    app.webview_windows()
        .iter()
        .filter_map(|(label, _win)| label.strip_prefix("cat-").map(|id| id.to_string()))
        .collect()
}

/// 列出当前「显示中」的猫 id：窗口可见且未最小化（在桌面能看到）。
///
/// 与 pet_list_shown_cats（窗口存在=上班）区分：上班中的猫可能被「老板来了」
/// 最小化藏起来，此时它仍算上班、但不在本列表——即卡片上的「隐藏」状态。
#[tauri::command]
pub fn pet_list_visible_cats(app: tauri::AppHandle) -> Vec<String> {
    app.webview_windows()
        .iter()
        .filter_map(|(label, win)| {
            let id = label.strip_prefix("cat-")?;
            let visible = win.is_visible().unwrap_or(false);
            let minimized = win.is_minimized().unwrap_or(false);
            (visible && !minimized).then(|| id.to_string())
        })
        .collect()
}

/// Exit the app. Mirrors the tray-icon "退出" item.
#[tauri::command]
pub fn pet_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// 切换所有宠物窗显隐（「老板来了」全局快捷键调用）。
#[tauri::command]
pub async fn pet_toggle_visibility(app: tauri::AppHandle) {
    toggle_pet(&app);
    // 广播让设置页实时刷新显隐状态。
    let _ = app.emit("cat-windows-changed", ());
}

/// 切换**单只**猫窗的显隐（卡片「在线/隐身」点击用）：可见→最小化(隐身)，否则→恢复(在线)。
#[tauri::command]
pub async fn pet_toggle_cat_visible(app: tauri::AppHandle, cat_id: String) {
    if let Some(win) = app.get_webview_window(&format!("cat-{cat_id}")) {
        if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(true) {
            let _ = win.minimize();
        } else {
            let _ = win.unminimize();
            let _ = win.show();
        }
    }
    let _ = app.emit("cat-windows-changed", ());
}

/// 获取并清除待导航的标签页。设置窗口 onMounted 时调用。
#[tauri::command]
pub fn pet_consume_pending_tab(app: tauri::AppHandle) -> Option<String> {
    app.state::<PetState>()
        .pending_tab
        .lock()
        .ok()
        .and_then(|mut p| p.take())
}

/// Trigger a sprite animation on the frontend by emitting a "pet-play-action"
/// event with the action name.
#[tauri::command]
pub fn pet_play_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    app.emit("pet-play-action", action).map_err(|e| e.to_string())
}

/// 用系统默认程序打开外部链接：`http(s)` 交给浏览器、`mailto:` 交给邮件客户端。
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
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
