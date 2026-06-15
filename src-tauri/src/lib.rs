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

/// Bring the pet window back into view: unminimize, show, and focus it.
/// The window has a fixed size (see `fixed_window_size`), so there's nothing to
/// resize. Used by the "设置" tray menu item to restore the window before
/// opening the settings panel.
fn show_pet(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("duoduo") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
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

/// Show the pet window and open the in-window menu panel, so the user can
/// access settings (e.g. disable invisibility mode) from the tray.
fn open_settings(app: &tauri::AppHandle) {
    show_pet(app);
    let _ = app.emit("pet-open-menu", ());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PetState {
            scale: Mutex::new(1.0),
            head_offset: Mutex::new((0.0, 0.0)),
        })
        .invoke_handler(tauri::generate_handler![
            pet_cursor_angle,
            pet_ctrl_pressed,
            pet_set_content_scale,
            pet_set_head_offset,
            pet_quit,
            pet_play_action
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
            let settings = MenuItem::with_id(app, "settings", "⚙ 设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
