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

/// The window's fixed physical size: a square sized to hold the largest cat
/// (PET_BASE_PX × PET_MAX_SCALE). The cat is centered inside it and the in-window
/// radial menu (smaller than the max cat) also pops up centered, so no left-side
/// reserve is needed. Computed once from the monitor's scale factor; the window
/// keeps this size for its whole lifetime regardless of the slider.
pub fn fixed_window_size(scale_factor: f64) -> tauri::PhysicalSize<u32> {
    let cat_px = (PET_BASE_PX * PET_MAX_SCALE * scale_factor).round() as u32;
    tauri::PhysicalSize::new(cat_px, cat_px)
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

/// Bounding box of all monitors' **full areas** in physical pixels:
/// (min_x, min_y, max_x, max_y). Uses each monitor's full size (NOT the work
/// area), so the pet can be dragged right up to the physical screen edges and
/// over the taskbar/dock — it just can't leave the screen entirely. The startup
/// position still uses the work area (see lib.rs) so the cat *starts* above the
/// taskbar, but the user is free to drag it onto/past the taskbar afterwards.
fn combined_full_area(window: &tauri::Window) -> Result<(i32, i32, i32, i32), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("no monitors available".into());
    }
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    for m in monitors {
        let p = m.position();
        let s = m.size();
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x + s.width as i32);
        max_y = max_y.max(p.y + s.height as i32);
    }
    Ok((min_x, min_y, max_x, max_y))
}

/// Clamp the window so the **cat sprite** (not the whole window) stays within
/// the bounding box of all monitors' full screen areas (taskbar included). The
/// cat is centered in the fixed square window; when the sprite is smaller than
/// the window the surrounding margin is transparent and allowed to hang
/// off-screen — only the visible cat content is kept on-screen, and it may be
/// dragged right up to the physical screen edges and over the taskbar.
///
/// The sprite is `PET_BASE_PX * scale` logical px, centered in the window;
/// converting to physical px (× scale_factor) gives its real size. We compute
/// the content box's top-left, clamp THAT to the screen area, then derive the
/// window position back from it. Idempotent; called from the Moved handler.
pub fn clamp_to_work_area(window: &tauri::Window) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (min_x, min_y, max_x, max_y) = combined_full_area(window)?;

    let scale = window
        .state::<PetState>()
        .scale
        .lock()
        .map(|g| *g)
        .unwrap_or(1.0);
    let sf = window.scale_factor().map_err(|e| e.to_string())?;

    // Cat is centered in the window.
    let content = (PET_BASE_PX * scale * sf).round();
    let win_w = size.width as f64;
    let win_h = size.height as f64;
    let off_x = (win_w - content) / 2.0; // cat centered horizontally
    let off_y = (win_h - content) / 2.0; // cat centered vertically

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
