//! 窗口几何：固定尺寸计算 + 把猫的内容框 clamp 到所有显示器并集 + 缩放缓存。

use tauri::{Manager, PhysicalPosition};

use crate::state::PetState;

/// The cat sprite's base size in logical (CSS) pixels — must match the `200`
/// in Pet.vue's `imgStyle` (`Math.round(200 * size)`).
pub const PET_BASE_PX: f64 = 200.0;

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
pub fn fixed_window_size(scale_factor: f64) -> tauri::PhysicalSize<u32> {
    let cat_px = (PET_BASE_PX * PET_MAX_SCALE * scale_factor).round() as u32;
    let menu_w = (MENU_EXTRA_W_LP * scale_factor).round() as u32;
    let menu_h = (MENU_EXTRA_H_LP * scale_factor).round() as u32;
    tauri::PhysicalSize::new(cat_px + menu_w, cat_px.max(menu_h))
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
pub fn clamp_to_work_area(window: &tauri::Window) -> Result<(), String> {
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
pub fn pet_set_content_scale(window: tauri::Window, scale: f64) -> Result<(), String> {
    let s = scale.clamp(0.1, 8.0);
    if let Ok(mut g) = window.state::<PetState>().scale.lock() {
        *g = s;
    }
    clamp_to_work_area(&window)?;
    Ok(())
}
