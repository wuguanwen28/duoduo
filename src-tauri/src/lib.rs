use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition,
};

/// The cat sprite's base size in logical (CSS) pixels — must match the `200`
/// in Pet.vue's `imgStyle` (`Math.round(200 * size)`).
const PET_BASE_PX: f64 = 200.0;

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
/// Also resizes to the cat's current sprite size in case the window was
/// shrunk to 200×200 by the menu-close path before being minimised.
/// Used by the tray "显示多多" item and a left-click on the tray icon.
fn show_pet(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("pet") {
        // Restore the window first — set_size on a minimized window may be
        // ignored by the OS.
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // Now resize to the cat's actual sprite size (the menu-close path
        // may have shrunk it to 200×200 before minimisation).
        let scale = window
            .state::<PetState>()
            .scale
            .lock()
            .map(|g| *g)
            .unwrap_or(1.0);
        let sf = window.scale_factor().unwrap_or(1.0);
        let cat_px = (PET_BASE_PX * scale * sf).round() as u32;
        let _ = window.set_size(tauri::PhysicalSize::new(cat_px, cat_px));
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
/// The head centre is computed as the window centre + the user-calibrated
/// head offset (in physical pixels, so it stays correct across DPIs and sizes).
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

    // Head centre in physical pixels (window centre + calibrated offset).
    let sprite_px = PET_BASE_PX * scale * sf;
    let cx = pos.x as f64 + size.width as f64 / 2.0 + ox_ratio * sprite_px;
    let cy = pos.y as f64 + size.height as f64 / 2.0 + oy_ratio * sprite_px;
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

/// Clamp the window so the **centered cat sprite** (not the whole window) stays
/// within the bounding box of all monitors. The window is an 800×500 box much
/// larger than the sprite, so the window's empty margins are allowed to hang
/// off-screen — only the visible cat content is kept on-screen.
///
/// The sprite is `PET_BASE_PX * scale` logical px, centered in the window;
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

    // Cat sprite size in physical pixels, and its centered offset within the window.
    let content = (PET_BASE_PX * scale * sf).round();
    let win_w = size.width as f64;
    let win_h = size.height as f64;
    let off_x = (win_w - content) / 2.0;
    let off_y = (win_h - content) / 2.0;

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
/// re-clamp so shrinking near an edge doesn't leave the cat off-screen.
#[tauri::command]
fn pet_set_content_scale(window: tauri::Window, scale: f64) -> Result<(), String> {
    let s = scale.clamp(0.1, 8.0);
    if let Ok(mut g) = window.state::<PetState>().scale.lock() {
        *g = s;
    }
    clamp_to_work_area(&window)?;
    Ok(())
}

/// Resize the window to fit the cat sprite plus the menu panel (or back to
/// just the cat). The cat occupies the RIGHT side of the window; when the menu
/// is open it appears to the LEFT, so we expand the window leftward and shift
/// the window's x position by the same amount to keep the cat in place.
///
/// `open`: true = menu just opened, false = menu just closed.
#[tauri::command]
fn pet_resize_for_menu(window: tauri::Window, open: bool) -> Result<(), String> {
    use tauri::PhysicalSize;

    let state = window.state::<PetState>();
    let scale = state.scale.lock().map(|g| *g).unwrap_or(1.0);
    let sf = window.scale_factor().map_err(|e| e.to_string())?;

    let cat_px = (PET_BASE_PX * scale * sf).round() as u32;
    // Menu: 200 logical wide, ~346 logical tall, 10 logical gap on each side.
    let menu_extra_w = ((200.0 + 20.0) * sf).round() as u32;
    let menu_extra_h = ((346.0 + 20.0) * sf).round() as u32;

    let pos = window.outer_position().map_err(|e| e.to_string())?;

    let (new_w, new_h, dx) = if open {
        (
            cat_px + menu_extra_w,
            cat_px.max(menu_extra_h),
            -(menu_extra_w as i32),
        )
    } else {
        (cat_px, cat_px, menu_extra_w as i32)
    };

    window
        .set_size(PhysicalSize::new(new_w, new_h))
        .map_err(|e| e.to_string())?;
    // Shift x to keep the cat in the same screen position.
    let _ = window.set_position(PhysicalPosition::new(pos.x + dx, pos.y));
    clamp_to_work_area(&window)?;
    Ok(())
}

/// Resize the pet window and re-clamp the position so it doesn't extend past
/// the work area after the size change. Currently unused by the in-window
/// menu (it scales the sprite image instead) but kept available for callers
/// that want to drive the window size programmatically.
#[tauri::command]
fn pet_set_size(window: tauri::Window, scale: f64) -> Result<(), String> {
    use tauri::PhysicalSize;
    let s = scale.clamp(0.25, 4.0);
    let base = 200.0_f64;
    let w = (base * s).round().max(40.0) as u32;
    let h = (base * s).round().max(40.0) as u32;
    window
        .set_size(PhysicalSize::new(w, h))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PetState {
            scale: Mutex::new(1.0),
            head_offset: Mutex::new((0.0, 0.0)),
        })
        .invoke_handler(tauri::generate_handler![
            pet_cursor_angle,
            pet_set_size,
            pet_set_content_scale,
            pet_set_head_offset,
            pet_resize_for_menu,
            pet_quit
        ])
        .on_window_event(|window, event| {
            // Clamp the pet to the union of all monitors. There is only one
            // window now (the menu lives inside it), so this affects the
            // single "pet" window.
            if let tauri::WindowEvent::Moved(_) = event {
                if window.label() == "pet" {
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
            // monitor's work area (clear of the taskbar).
            if let Some(window) = app.get_webview_window("pet") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let area = monitor.work_area();
                    let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(800, 500));
                    let x = area.position.x + area.size.width as i32 - win_size.width as i32;
                    let y = area.position.y + area.size.height as i32 - win_size.height as i32;
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
