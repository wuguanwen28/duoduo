use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition,
};

/// The cat sprite's base size in logical (CSS) pixels — must match the `200`
/// in Pet.vue's `imgStyle` (`Math.round(200 * size)`).
const PET_BASE_PX: f64 = 200.0;

/// Width / height (logical px) reserved on the LEFT side of the window for the
/// in-window menu panel. Includes the menu itself (200×~346) + 10 px gap on
/// each side. The window is always wide enough to hold the cat (right-aligned)
/// plus this reserve, so the menu can pop up on the left without a dynamic resize.
const MENU_EXTRA_W_LP: f64 = 220.0; // 200 menu + 10 gap × 2
const MENU_EXTRA_H_LP: f64 = 366.0; // ~346 menu + 10 gap × 2

/// Shared app state. `scale` mirrors the in-window size slider so the clamp
/// logic knows the cat's real on-screen size (the window itself is a fixed
/// 800×500 box much larger than the centered sprite).
///
/// `head_offset` stores the ratio of the head-centre offset to the sprite
/// diameter, calibrated by the user so the dead-zone tracks the actual head.
struct PetState {
    scale: Mutex<f64>,
    head_offset: Mutex<(f64, f64)>,
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
/// Resizes to the cat's current sprite size + the left-side menu reserve
/// (the window always includes space for the menu, even when closed).
/// Used by the tray "显示多多" item and a left-click on the tray icon.
fn show_pet(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("duoduo") {
        // Restore the window first — set_size on a minimized window may be
        // ignored by the OS.
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let scale = window
            .state::<PetState>()
            .scale
            .lock()
            .map(|g| *g)
            .unwrap_or(1.0);
        let sf = window.scale_factor().unwrap_or(1.0);
        let cat_px = (PET_BASE_PX * scale * sf).round() as u32;
        let menu_w = (MENU_EXTRA_W_LP * sf).round() as u32;
        let menu_h = (MENU_EXTRA_H_LP * sf).round() as u32;
        let _ = window.set_size(tauri::PhysicalSize::new(
            cat_px + menu_w,
            cat_px.max(menu_h),
        ));
    }
}

/// Fraction of the sprite's radius treated as a "look forward" dead zone around
/// the cat's head. Inside this radius the gaze angle is unstable (tiny cursor
/// moves swing atan2 wildly), so we report no direction and the frontend locks
/// to frame 0 (facing forward).
const HEAD_DEAD_ZONE_FRAC: f64 = 0.1225;

/// Angle (in degrees, screen convention: 0 = +x/right, 90 = down, measured
/// clockwise) from the cat's head centre to the global mouse cursor.
///
/// The cat sprite is right-aligned and bottom-aligned in the window (menu
/// reserve on the left), so the head centre = window right edge - sprite/2
/// (X), window bottom edge - sprite/2 (Y), plus calibrated offset.
/// Returns `None` when the cursor falls inside the head dead zone so the cat
/// faces forward instead of jittering.
#[tauri::command]
fn pet_cursor_angle(window: tauri::Window) -> Result<Option<f64>, String> {
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

    if (dx * dx + dy * dy).sqrt() < dead_radius {
        return Ok(None);
    }
    let deg = dy.atan2(dx).to_degrees().rem_euclid(360.0);
    Ok(Some(deg))
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

/// Update the cached sprite scale (mirrors the in-window size slider) and
/// resize the window so it always fits the cat (right-aligned) + the left-side
/// menu reserve. Re-clamps so growing near an edge doesn't push the cat off-screen.
#[tauri::command]
fn pet_set_content_scale(window: tauri::Window, scale: f64) -> Result<(), String> {
    let s = scale.clamp(0.1, 8.0);
    if let Ok(mut g) = window.state::<PetState>().scale.lock() {
        *g = s;
    }
    let sf = window.scale_factor().map_err(|e| e.to_string())?;
    let cat_px = (PET_BASE_PX * s * sf).round() as u32;
    let menu_w = (MENU_EXTRA_W_LP * sf).round() as u32;
    let menu_h = (MENU_EXTRA_H_LP * sf).round() as u32;
    window
        .set_size(tauri::PhysicalSize::new(cat_px + menu_w, cat_px.max(menu_h)))
        .map_err(|e| e.to_string())?;
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
            // Tray icon with a Quit item — the window has system decorations
            // (close button), but this is a redundant way to close the pet
            // (the other being the in-window menu's "下班" button).
            let show = MenuItem::with_id(app, "show", "显示多多", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                // Left-click restores the window; right-click shows the menu
                // (显示多多 / 退出). Keep these on separate buttons so they
                // don't fight each other.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_pet(app),
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
                        show_pet(tray.app_handle());
                    }
                })
                .build(app)?;

            // Position the pet window at the bottom-right of the primary
            // monitor's work area (clear of the taskbar). Resize first so the
            // window includes the left-side menu reserve from the start.
            if let Some(window) = app.get_webview_window("duoduo") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let area = monitor.work_area();
                    let sf = window.scale_factor().unwrap_or(1.0);
                    let cat_px = (PET_BASE_PX * sf).round() as u32;
                    let menu_w = (MENU_EXTRA_W_LP * sf).round() as u32;
                    let menu_h = (MENU_EXTRA_H_LP * sf).round() as u32;
                    let _ = window.set_size(tauri::PhysicalSize::new(
                        cat_px + menu_w,
                        cat_px.max(menu_h),
                    ));
                    let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(
                        cat_px + menu_w,
                        cat_px.max(menu_h),
                    ));
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
