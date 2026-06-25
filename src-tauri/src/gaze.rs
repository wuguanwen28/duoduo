//! 注视：上报猫头到光标的角度 + 光标是否在猫框内（供穿透切换）+ 头部校准。

use tauri::Manager;

use crate::geometry::PET_BASE_PX;
use crate::state::PetState;

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
pub struct GazeSample {
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
/// The cat sprite is **horizontally centered and bottom-aligned** inside the
/// fixed window (top area is transparent headroom for the speech bubble), so
/// the head centre = window horizontal center, plus `sprite_px/2` up from the
/// window bottom, plus the calibrated offset.
#[tauri::command]
pub fn pet_cursor_angle(window: tauri::Window) -> Result<GazeSample, String> {
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;

    let state = window.state::<PetState>();
    let scale = state.scale.lock().map(|g| *g).unwrap_or(1.0);
    let (ox_ratio, oy_ratio) = state.head_offset.lock().map(|g| *g).unwrap_or((0.0, 0.0));
    let sf = window.scale_factor().map_err(|e| e.to_string())?;

    // 猫横向居中、纵向贴底；头中心 = (窗口横向中心, 窗口底向上 sprite_px/2)。
    let sprite_px = PET_BASE_PX * scale * sf;
    let cat_cx = pos.x as f64 + size.width as f64 / 2.0;
    let cat_cy = pos.y as f64 + size.height as f64 - sprite_px / 2.0;
    let cx = cat_cx + ox_ratio * sprite_px;
    let cy = cat_cy + oy_ratio * sprite_px;
    let dx = cursor.x - cx;
    let dy = cursor.y - cy;

    let dead_radius = PET_BASE_PX / 2.0 * scale * sf * HEAD_DEAD_ZONE_FRAC;

    let angle = if (dx * dx + dy * dy).sqrt() < dead_radius {
        None
    } else {
        Some(dy.atan2(dx).to_degrees().rem_euclid(360.0))
    };

    // 猫精灵占一个 sprite_px 大小的方框：横向以 cat_cx 居中、纵向贴窗口底（中线为 cat_cy）。
    // 点在框内 = 落在猫身上，需要保持交互；框外为透明区，应当穿透。
    let over_cat = cursor.x >= cat_cx - sprite_px / 2.0
        && cursor.x <= cat_cx + sprite_px / 2.0
        && cursor.y >= cat_cy - sprite_px / 2.0
        && cursor.y <= cat_cy + sprite_px / 2.0;

    Ok(GazeSample {
        angle,
        cursor_x: cursor.x,
        cursor_y: cursor.y,
        over_cat,
    })
}

/// Update the user-calibrated head offset (ratio of sprite diameter).
#[tauri::command]
pub fn pet_set_head_offset(window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    if let Ok(mut g) = window.state::<PetState>().head_offset.lock() {
        *g = (x, y);
    }
    Ok(())
}
