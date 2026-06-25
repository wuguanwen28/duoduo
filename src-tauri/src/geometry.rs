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

/// 窗口顶部预留给说话气泡的逻辑像素余量（向上展开的空间）。
/// 取值需 ≥ `SpeechBubble.vue` 里所有云朵的最大高度（最大 `maxW=210`，
/// 比例约 1:1 → ≈210 px），这里再多留 10 px 防止顶端被裁。
pub const BUBBLE_HEADROOM_PX: f64 = 220.0;

/// 窗口固定物理尺寸：宽度等于"最大猫"边长，高度等于"最大猫" + 顶部气泡余量。
/// 猫在窗口内**底对齐**（详见 `clamp_to_work_area` 的 `off_y` 计算），
/// 上方留出 `BUBBLE_HEADROOM_PX` 给说话气泡向上展开，不会被窗口裁顶。
/// 启动时按显示器缩放因子计算一次，窗口存续期间不再变化（大小滑块只缩内层精灵）。
pub fn fixed_window_size(scale_factor: f64) -> tauri::PhysicalSize<u32> {
    let cat_px = (PET_BASE_PX * PET_MAX_SCALE * scale_factor).round() as u32;
    let headroom_px = (BUBBLE_HEADROOM_PX * scale_factor).round() as u32;
    tauri::PhysicalSize::new(cat_px, cat_px + headroom_px)
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
/// cat is **bottom-aligned** in the window (top area is reserved as transparent
/// headroom for the speech bubble); when the sprite is smaller than the cat
/// slot the horizontal margin and the headroom hang off-screen as transparent
/// padding — only the visible cat content is kept on-screen, and it may be
/// dragged right up to the physical screen edges and over the taskbar.
///
/// The sprite is `PET_BASE_PX * scale` logical px, horizontally centered and
/// bottom-aligned in the window; converting to physical px (× scale_factor)
/// gives its real size. We compute the content box's top-left, clamp THAT to
/// the screen area, then derive the window position back from it. Idempotent;
/// called from the Moved handler.
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

    // 猫横向居中、纵向贴窗口底（顶部那段为气泡余量，透明）。
    let content = (PET_BASE_PX * scale * sf).round();
    let win_w = size.width as f64;
    let win_h = size.height as f64;
    let off_x = (win_w - content) / 2.0; // 横向居中
    let off_y = win_h - content; // 纵向贴底，与 Pet.vue 的 align-items: flex-end 一致

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
