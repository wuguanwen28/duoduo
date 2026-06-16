use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition,
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};

/// The cat sprite's base size in logical (CSS) pixels — must match the `200`
/// in Pet.vue's `imgStyle` (`Math.round(200 * size)`).
const PET_BASE_PX: f64 = 200.0;

/// The size slider's maximum multiplier — must match `:max` on Menu.vue's
/// `el-slider`. The window is sized once to fit the cat at this scale, so it
/// never has to resize as the slider moves (the sprite just scales inside the
/// fixed, transparent, click-through window).
const PET_MAX_SCALE: f64 = 2.0;

/// Width / height (logical px) reserved on the LEFT side of the window for the
/// in-window menu panel. Includes the menu itself (200×~346) + 10 px gap on
/// each side. The window is wide enough to hold the largest cat (right-aligned)
/// plus this reserve, so the menu pops up on the left without any resize.
const MENU_EXTRA_W_LP: f64 = 220.0; // 200 menu + 10 gap × 2
const MENU_EXTRA_H_LP: f64 = 366.0; // ~346 menu + 10 gap × 2

/// The window's fixed physical size: the cat at PET_MAX_SCALE (right-aligned) +
/// the left-side menu reserve. Computed once from the monitor's scale factor;
/// the window keeps this size for its whole lifetime regardless of the slider.
fn fixed_window_size(scale_factor: f64) -> tauri::PhysicalSize<u32> {
    let cat_px = (PET_BASE_PX * PET_MAX_SCALE * scale_factor).round() as u32;
    let menu_w = (MENU_EXTRA_W_LP * scale_factor).round() as u32;
    let menu_h = (MENU_EXTRA_H_LP * scale_factor).round() as u32;
    tauri::PhysicalSize::new(cat_px + menu_w, cat_px.max(menu_h))
}

/// Shared app state. `scale` mirrors the in-window size slider so the gaze and
/// clamp logic know the cat's real on-screen size (the window itself is a fixed
/// box sized for the largest cat + menu — see `fixed_window_size`; the sprite
/// scales inside it without resizing the window).
///
/// `head_offset` stores the ratio of the head-centre offset to the sprite
/// diameter, calibrated by the user so the dead-zone tracks the actual head.
struct PetState {
    scale: Mutex<f64>,
    head_offset: Mutex<(f64, f64)>,
    tray_icon: Mutex<Option<tauri::tray::TrayIconId>>,
}

#[tauri::command]
fn pet_ctrl_pressed() -> bool {
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

/// Clamp helper that tolerates an inverted range (lo > hi), which happens when
/// the content is larger than the work area — in that case pin to `lo`.
fn clampf(v: f64, lo: f64, hi: f64) -> f64 {
    if lo > hi {
        lo
    } else {
        v.max(lo).min(hi)
    }
}

/// Toggle the pet window: if visible and not minimized, minimize it;
/// otherwise restore (unminimize + show + focus).
fn toggle_pet(app: &tauri::AppHandle) {
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
fn open_settings(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    // 设置窗加载独立入口 settings.html（vite 多入口构建），渲染 <SettingsApp>。
    let url = tauri::WebviewUrl::App("settings.html".into());
    // 使用 256×256 高清图标，避免任务栏显示模糊。
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
        .expect("加载窗口图标失败");
    match tauri::WebviewWindowBuilder::new(app, "settings", url)
        .title("设置")
        .inner_size(720.0, 600.0)
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
        }
        Err(e) => eprintln!("open settings window failed: {e}"),
    }
}

/// Fraction of the sprite's radius treated as a "look forward" dead zone around
/// the cat's head. Inside this radius the gaze angle is unstable (tiny cursor
/// moves swing atan2 wildly), so we report no direction and the frontend locks
/// to frame 0 (facing forward).
const HEAD_DEAD_ZONE_FRAC: f64 = 0.1225;

/// Result of a gaze sample: the gaze angle plus the raw global cursor position.
///
/// `angle` follows the screen convention (0 = +x/right, 90 = down, clockwise)
/// from the cat's head centre to the cursor, or `None` when the cursor sits
/// inside the head dead zone (so the cat faces forward instead of jittering).
///
/// `cursor_x` / `cursor_y` are the raw global cursor coordinates (physical px),
/// always present regardless of the dead zone. The frontend's state machine
/// uses them to tell whether the mouse has moved since the last tick.
#[derive(serde::Serialize)]
struct GazeSample {
    angle: Option<f64>,
    cursor_x: f64,
    cursor_y: f64,
    /// Whether the cursor is inside the cat sprite's screen rect. The frontend
    /// uses this to toggle window click-through: clicks over the cat stay with
    /// the window, clicks on the transparent margin pass through to apps behind.
    over_cat: bool,
}

/// Sample the cursor gaze. Returns the angle from the cat's head to the global
/// cursor (see `GazeSample`) together with the raw cursor position.
///
/// The cat sprite is right-aligned and bottom-aligned in the window (menu
/// reserve on the left), so the head centre = window right edge - sprite/2
/// (X), window bottom edge - sprite/2 (Y), plus calibrated offset.
#[tauri::command]
fn pet_cursor_angle(window: tauri::Window) -> Result<GazeSample, String> {
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;

    let state = window.state::<PetState>();
    let scale = state.scale.lock().map(|g| *g).unwrap_or(1.0);
    let (ox_ratio, oy_ratio) = state.head_offset.lock().map(|g| *g).unwrap_or((0.0, 0.0));
    let sf = window.scale_factor().map_err(|e| e.to_string())?;

    // Cat is right-aligned and bottom-aligned.
    let sprite_px = PET_BASE_PX * scale * sf;
    let cx = pos.x as f64 + size.width as f64 - sprite_px / 2.0 + ox_ratio * sprite_px;
    let cy = pos.y as f64 + size.height as f64 - sprite_px / 2.0 + oy_ratio * sprite_px;
    let dx = cursor.x - cx;
    let dy = cursor.y - cy;

    let dead_radius = PET_BASE_PX / 2.0 * scale * sf * HEAD_DEAD_ZONE_FRAC;

    let angle = if (dx * dx + dy * dy).sqrt() < dead_radius {
        None
    } else {
        Some(dy.atan2(dx).to_degrees().rem_euclid(360.0))
    };

    // The cat fills a `sprite_px` square anchored to the window's bottom-right.
    // A click inside that box belongs to the cat; everything else is empty and
    // should pass through (see the frontend's click-through toggle).
    let sprite_right = pos.x as f64 + size.width as f64;
    let sprite_bottom = pos.y as f64 + size.height as f64;
    let over_cat = cursor.x >= sprite_right - sprite_px
        && cursor.x <= sprite_right
        && cursor.y >= sprite_bottom - sprite_px
        && cursor.y <= sprite_bottom;

    Ok(GazeSample {
        angle,
        cursor_x: cursor.x,
        cursor_y: cursor.y,
        over_cat,
    })
}

/// Update the user-calibrated head offset (ratio of sprite diameter) and
/// re-clamp the window position.
#[tauri::command]
fn pet_set_head_offset(window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    if let Ok(mut g) = window.state::<PetState>().head_offset.lock() {
        *g = (x, y);
    }
    Ok(())
}

/// Bounding box of all monitors' **work areas** in physical pixels:
/// (min_x, min_y, max_x, max_y). The work area excludes the taskbar/dock and
/// other reserved system bars, so the pet stays clear of the taskbar while
/// still being free to move across the whole extended desktop.
fn combined_work_area(window: &tauri::Window) -> Result<(i32, i32, i32, i32), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("no monitors available".into());
    }
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    for m in monitors {
        let area = m.work_area();
        let p = area.position;
        let s = area.size;
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x + s.width as i32);
        max_y = max_y.max(p.y + s.height as i32);
    }
    Ok((min_x, min_y, max_x, max_y))
}

/// Clamp the window so the **cat sprite** (not the whole window) stays within
/// the bounding box of all monitors. The window has extra space on the left for
/// the menu panel; the cat is right-aligned. Only the visible cat content is
/// kept on-screen — the window's left margin is allowed to hang off-screen.
///
/// The sprite is `PET_BASE_PX * scale` logical px, right-aligned in the window;
/// converting to physical px (× scale_factor) gives its real size. We compute
/// the content box's top-left, clamp THAT to the work area, then derive the
/// window position back from it. Idempotent; called from the Moved handler.
fn clamp_to_work_area(window: &tauri::Window) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (min_x, min_y, max_x, max_y) = combined_work_area(window)?;

    let scale = window
        .state::<PetState>()
        .scale
        .lock()
        .map(|g| *g)
        .unwrap_or(1.0);
    let sf = window.scale_factor().map_err(|e| e.to_string())?;

    // Cat is right-aligned & bottom-aligned.
    let content = (PET_BASE_PX * scale * sf).round();
    let win_w = size.width as f64;
    let win_h = size.height as f64;
    let off_x = win_w - content; // cat is at the right edge
    let off_y = win_h - content; // cat is at the bottom edge

    // Current content top-left in screen space.
    let content_x = pos.x as f64 + off_x;
    let content_y = pos.y as f64 + off_y;

    // Clamp the content box (not the window) to the work area.
    let new_content_x = clampf(content_x, min_x as f64, max_x as f64 - content);
    let new_content_y = clampf(content_y, min_y as f64, max_y as f64 - content);

    // Derive the window top-left back from the clamped content position.
    let new_x = (new_content_x - off_x).round() as i32;
    let new_y = (new_content_y - off_y).round() as i32;

    if new_x != pos.x || new_y != pos.y {
        window
            .set_position(PhysicalPosition::new(new_x, new_y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Update the cached sprite scale (mirrors the in-window size slider). The
/// window has a fixed size and is NOT resized here — the sprite just scales
/// inside it. We still re-clamp so that enlarging the cat near a screen edge
/// doesn't leave part of it hanging off-screen.
#[tauri::command]
fn pet_set_content_scale(window: tauri::Window, scale: f64) -> Result<(), String> {
    let s = scale.clamp(0.1, 8.0);
    if let Ok(mut g) = window.state::<PetState>().scale.lock() {
        *g = s;
    }
    clamp_to_work_area(&window)?;
    Ok(())
}

/// Exit the app. Mirrors the tray-icon "退出" item, exposed to the in-window
/// menu's "下班" button.
#[tauri::command]
fn pet_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Trigger a sprite animation on the frontend by emitting a "pet-play-action"
/// event with the action name. The frontend's SpriteAnimator component plays
/// the corresponding frame sequence.
#[tauri::command]
fn pet_play_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    app.emit("pet-play-action", action).map_err(|e| e.to_string())
}

/// 外置资源根目录的定位优先级：
/// 1) 环境变量 `DUODUO_RESOURCES`（手动覆盖，便于调试/多套素材）；
/// 2) 开发模式（debug）：项目根下的 `resources/`；
/// 3) 发布模式：exe 同级的 `resources/`。
fn resource_root() -> PathBuf {
    if let Ok(p) = std::env::var("DUODUO_RESOURCES") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    #[cfg(debug_assertions)]
    {
        // 开发模式下 CARGO_MANIFEST_DIR 指向 src-tauri，其父目录即项目根。
        if let Some(root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            return root.join("resources");
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("resources");
        }
    }
    PathBuf::from("resources")
}

/// 受支持的帧图片扩展名（统一按小写比较）。
const FRAME_EXTS: [&str; 6] = ["webp", "png", "jpg", "jpeg", "gif", "bmp"];

/// 列出某动作目录下、按文件名排序的帧文件绝对路径。
/// `dir` 是绝对路径时直接使用，否则拼接到资源根下。
fn list_frames(root: &Path, dir: &str) -> Vec<PathBuf> {
    let p = Path::new(dir);
    let full = if p.is_absolute() { p.to_path_buf() } else { root.join(p) };
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&full) {
        for e in entries.flatten() {
            let path = e.path();
            if !path.is_file() {
                continue;
            }
            let ok = path
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| FRAME_EXTS.contains(&x.to_lowercase().as_str()))
                .unwrap_or(false);
            if ok {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// `pet_scan_resources` 的返回结构。
#[derive(serde::Serialize)]
struct ScanResult {
    /// 资源根目录的绝对路径（便于前端展示/排错）。
    root: String,
    /// manifest.json 原样返回，强类型解析放在前端做。
    manifest: serde_json::Value,
    /// 动作名 → 帧文件绝对路径数组；跟随帧用特殊键 `"follow"`。
    frames: HashMap<String, Vec<String>>,
    /// 出错信息：读不到或解析失败时填入，前端据此显示「缺资源引导」。
    error: Option<String>,
}

/// 扫描外置资源：读取 manifest.json，按 follow / actions 里各自的 `dir`
/// 列出帧文件绝对路径，并把这些目录加入 asset 协议白名单，使前端能用
/// `convertFileSrc` 直接加载磁盘上的图片。一次性返回，减少前后端往返。
#[tauri::command]
fn pet_scan_resources(app: tauri::AppHandle) -> ScanResult {
    let root = resource_root();
    let root_str = root.display().to_string();
    let manifest_path = root.join("manifest.json");

    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) => {
            return ScanResult {
                root: root_str,
                manifest: serde_json::Value::Null,
                frames: HashMap::new(),
                error: Some(format!(
                    "读不到 manifest.json（{}）：{e}",
                    manifest_path.display()
                )),
            }
        }
    };
    let manifest: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            return ScanResult {
                root: root_str,
                manifest: serde_json::Value::Null,
                frames: HashMap::new(),
                error: Some(format!("manifest.json 解析失败：{e}")),
            }
        }
    };

    // 资源根递归加入 asset 白名单；绝对路径的动作目录下面再逐个补授权。
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&root, true);

    // 先汇总所有 (键, 目录)，再统一扫描，避免闭包对 frames 的可变借用冲突。
    let mut dirs: Vec<(String, String)> = Vec::new();
    if let Some(dir) = manifest
        .get("follow")
        .and_then(|f| f.get("dir"))
        .and_then(|d| d.as_str())
    {
        dirs.push(("follow".to_string(), dir.to_string()));
    }
    if let Some(actions) = manifest.get("actions").and_then(|a| a.as_object()) {
        for (name, def) in actions {
            if let Some(dir) = def.get("dir").and_then(|d| d.as_str()) {
                dirs.push((name.clone(), dir.to_string()));
            }
        }
    }

    let mut frames: HashMap<String, Vec<String>> = HashMap::new();
    for (key, dir) in dirs {
        if Path::new(&dir).is_absolute() {
            let _ = scope.allow_directory(Path::new(&dir), false);
        }
        let paths = list_frames(&root, &dir);
        frames.insert(
            key,
            paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
        );
    }

    ScanResult {
        root: root_str,
        manifest,
        frames,
        error: None,
    }
}

/// `pet_read_manifest` 的返回结构。
#[derive(serde::Serialize)]
struct ManifestFile {
    /// 资源根目录绝对路径。
    root: String,
    /// manifest.json 的绝对路径。
    path: String,
    /// 文件文本内容；不存在时为空串。
    content: String,
    /// 文件是否已存在。
    exists: bool,
}

/// 读取资源根目录下的 manifest.json 原文（供设置窗编辑）。不存在不报错，
/// 返回 exists=false + 空内容，由前端给出默认模板。
#[tauri::command]
fn pet_read_manifest() -> ManifestFile {
    let root = resource_root();
    let path = root.join("manifest.json");
    let exists = path.is_file();
    let content = if exists {
        std::fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };
    ManifestFile {
        root: root.display().to_string(),
        path: path.display().to_string(),
        content,
        exists,
    }
}

/// 把内容写回资源根目录下的 manifest.json（目录不存在则创建）。
/// 「没有就直接创建」即由此实现。
#[tauri::command]
fn pet_write_manifest(content: String) -> Result<(), String> {
    let root = resource_root();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(root.join("manifest.json"), content).map_err(|e| e.to_string())
}

/// 自定义图标的保存路径（exe 同级或项目根下）。
fn icon_path() -> PathBuf {
    let root = resource_root();
    root.join("app-icon.png")
}

/// 从 base64 数据保存自定义图标并更新窗口和托盘图标。
#[tauri::command]
fn pet_save_icon(app: tauri::AppHandle, data: String) -> Result<(), String> {
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
    let path = icon_path();
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
fn pet_reset_icon(app: tauri::AppHandle) -> Result<(), String> {
    let path = icon_path();
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
fn load_custom_icon(app: &tauri::AppHandle) {
    let path = icon_path();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PetState {
            scale: Mutex::new(1.0),
            head_offset: Mutex::new((0.0, 0.0)),
            tray_icon: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            pet_cursor_angle,
            pet_ctrl_pressed,
            pet_set_content_scale,
            pet_set_head_offset,
            pet_quit,
            pet_play_action,
            pet_scan_resources,
            pet_read_manifest,
            pet_write_manifest,
            pet_save_icon,
            pet_reset_icon
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
                    if let Err(e) = clamp_to_work_area(window) {
                        eprintln!("clamp_to_work_area failed: {e}");
                    }
                }
            }
        })
        .setup(|app| {
            // 托盘菜单：设置（打开菜单面板）/ 退出。
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &quit])?;

            // 托盘使用 32×32 图标，系统托盘区本身就是小尺寸。
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("加载托盘图标失败");
            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                // 左键点击托盘图标 → 最小化/恢复来回切换；右键显示菜单。
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => open_settings(app),
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

            // Position the pet window at the bottom-right of the primary
            // monitor's work area (clear of the taskbar). The window uses its
            // fixed size (largest cat + menu reserve); we set it explicitly here
            // so it's correct from the start regardless of the config value.
            if let Some(window) = app.get_webview_window("duoduo") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let area = monitor.work_area();
                    let sf = window.scale_factor().unwrap_or(1.0);
                    let win_size = fixed_window_size(sf);
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
            load_custom_icon(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
