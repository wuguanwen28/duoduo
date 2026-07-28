//! 窗口几何：按当前猫尺寸动态计算窗口大小 + 把猫的内容框 clamp 到所有显示器并集 + 缩放缓存。
//!
//! 猫在窗口内始终**水平居中、纵向贴底**：上方预留 `BUBBLE_HEADROOM_PX` 给说话气泡 /
//! 菜单向上展开，左右各预留 `MENU_SIDE_RESERVE` 给菜单横向贴边回收。窗口大小随当前
//! `scale` 动态变化（不再固定为最大猫尺寸）；缩放时以猫脚（窗口底部中心）为屏幕锚点
//! 保持不动，避免猫在调大调小时"挪位"。

use std::time::{Duration, Instant};

use tauri::{Manager, PhysicalPosition};

use crate::state::PetState;

/// The cat sprite's base size in logical (CSS) pixels — must match the `200`
/// in Pet.vue's `imgStyle` (`Math.round(200 * size)`).
pub const PET_BASE_PX: f64 = 200.0;

/// 大小滑块的最大倍率 —— 必须与 `DisplaySettings.vue` 大小滑块的 `:max` 一致。
/// 仅用于 clamp `scale`，不再决定窗口尺寸（窗口已改为随当前 scale 动态变化）。
pub const PET_MAX_SCALE: f64 = 2.0;

/// 窗口顶部预留给说话气泡 / 菜单向上展开的逻辑像素余量。
/// 取值需 ≥ `SpeechBubble.vue` 里所有云朵的最大高度（最大 `maxW=210`，
/// 比例约 1:1 → ≈210 px），且 ≥ 菜单高度 `MENU_HEIGHT=138`；这里取 220 同时覆盖两者。
pub const BUBBLE_HEADROOM_PX: f64 = 220.0;

/// 窗口左右各预留的逻辑像素余量，需同时满足：
/// 1) 菜单横向贴边回收：`MENU_SIDE_RESERVE ≥ (MENU_WIDTH + 2 * MENU_EDGE_PADDING) / 2`
///    （`MENU_WIDTH=167`、`MENU_EDGE_PADDING=4` → ≥ 87.5）；
/// 2) 气泡水平居中于猫后不被裁：`MENU_SIDE_RESERVE ≥ maxW / 2 + 安全边距`
///    （气泡最大 `maxW=210` → ≥ 105，加边距取 120）。
/// 取 120 同时覆盖菜单与气泡。
pub const MENU_SIDE_RESERVE: f64 = 120.0;

/// 显示器并集边界的缓存有效期。走动时每帧 setPosition 都会触发 Moved → clamp，
/// 每次重新枚举显示器纯属浪费；500ms 足够短，显示器插拔也能及时跟上。
const MONITOR_BOUNDS_TTL: Duration = Duration::from_millis(500);

/// 猫内容框在窗口内的偏移与直径（物理像素）：横向居中、纵向贴底。
/// 返回 `(off_x, off_y, content)`，供 clamp 与行走边界共用同一套推导。
fn content_box(win_w: f64, win_h: f64, scale: f64, sf: f64) -> (f64, f64, f64) {
    let content = (PET_BASE_PX * scale * sf).round();
    ((win_w - content) / 2.0, win_h - content, content)
}

/// 按当前猫尺寸计算窗口物理尺寸：宽 = 猫 + 左右各 `MENU_SIDE_RESERVE`，
/// 高 = 顶部 `BUBBLE_HEADROOM_PX` + 猫。猫在窗口内水平居中、纵向贴底。
pub fn window_size_for(scale: f64, scale_factor: f64) -> tauri::PhysicalSize<u32> {
    let cat_px = (PET_BASE_PX * scale * scale_factor).round() as u32;
    let side_px = (MENU_SIDE_RESERVE * scale_factor).round() as u32;
    let top_px = (BUBBLE_HEADROOM_PX * scale_factor).round() as u32;
    tauri::PhysicalSize::new(cat_px + 2 * side_px, top_px + cat_px)
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
///
/// 结果按 `MONITOR_BOUNDS_TTL` 缓存在 `PetState.monitor_bounds`：走动期间本函数
/// 会被每帧 Moved 触发的 clamp 调到，重复枚举显示器代价不小。
fn combined_full_area(window: &tauri::Window) -> Result<(i32, i32, i32, i32), String> {
    let state = window.state::<PetState>();
    if let Ok(guard) = state.monitor_bounds.lock() {
        if let Some((at, bounds)) = *guard {
            if at.elapsed() < MONITOR_BOUNDS_TTL {
                return Ok(bounds);
            }
        }
    }

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
    let bounds = (min_x, min_y, max_x, max_y);
    if let Ok(mut guard) = state.monitor_bounds.lock() {
        *guard = Some((Instant::now(), bounds));
    }
    Ok(bounds)
}

/// Clamp the window so the **cat sprite** (not the whole window) stays within
/// the bounding box of all monitors' full screen areas (taskbar included). The
/// cat is **bottom-aligned and horizontally centered** in the window; the
/// transparent margins (top headroom + side reserves) may hang off-screen as
/// transparent padding — only the visible cat content is kept on-screen.
///
/// The sprite is `PET_BASE_PX * scale` logical px, horizontally centered and
/// bottom-aligned in the window; converting to physical px (× scale_factor)
/// gives its real size. We compute the content box's top-left, clamp THAT to
/// the screen area, then derive the window position back from it. Idempotent;
/// called from the Moved handler and after every anchored resize.
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
    let (off_x, off_y, content) =
        content_box(size.width as f64, size.height as f64, scale, sf);

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

/// 更新缓存的精灵缩放（镜像窗口内的大小滑块），并按当前 scale **动态调整窗口尺寸**：
/// 以猫脚（窗口底部中心）为屏幕锚点保持不动 —— 先记录旧窗口的底部中心屏幕坐标，
/// 再 `set_size` 成新尺寸，最后反推新左上角使猫脚落回原处，并重新 clamp 到屏幕内。
///
/// 最小化时 Windows 把窗口停到 `(-32000,-32000)`，此时跳过 resize/clamp，仅缓存 scale，
/// 避免与最小化停靠坐标冲突导致抖动。
#[tauri::command]
pub fn pet_set_content_scale(window: tauri::Window, scale: f64) -> Result<(), String> {
    let s = scale.clamp(0.1, PET_MAX_SCALE);

    // 最小化状态下不调整几何，只更新缓存（恢复后由 Moved/手动触发重新 clamp）。
    if window.is_minimized().unwrap_or(false) {
        if let Ok(mut g) = window.state::<PetState>().scale.lock() {
            *g = s;
        }
        return Ok(());
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let sf = window.scale_factor().map_err(|e| e.to_string())?;

    // 旧猫脚 = 旧窗口底部中心（猫水平居中、纵向贴底）。
    let old_foot_x = pos.x as f64 + size.width as f64 / 2.0;
    let old_foot_y = pos.y as f64 + size.height as f64;

    // 写入新 scale，供 gaze / clamp 计算使用。
    if let Ok(mut g) = window.state::<PetState>().scale.lock() {
        *g = s;
    }

    let new_size = window_size_for(s, sf);
    // 新窗口左上角：让新窗口底部中心 = 旧猫脚。
    let new_x = (old_foot_x - new_size.width as f64 / 2.0).round() as i32;
    let new_y = (old_foot_y - new_size.height as f64).round() as i32;

    window
        .set_size(new_size)
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(new_x, new_y))
        .map_err(|e| e.to_string())?;

    clamp_to_work_area(&window)?;
    Ok(())
}

/// 行走可取的**窗口左上角**范围（物理像素）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// 查询行走边界。与 `clamp_to_work_area` 用**同一套**推导，因此走动期间每次
/// setPosition 触发的 Moved clamp 都是幂等空操作，前后端不会互相拉扯。
///
/// `scale` 由前端传入而非读 `PetState.scale`：后者是全局单例（最后一个调
/// `pet_set_content_scale` 的猫写入），多猫且尺寸不同时会给出错误边界；
/// 每个宠物窗自己知道自己的 size，传进来最准确。
///
/// 内容比屏幕还大时会出现 `min > max`，此处**原样返回**不做兜底——前端据此
/// 判定"该轴无可行走空间"，直接不移动也不反射（否则会每帧反射产生抖动）。
#[tauri::command]
pub fn pet_walk_bounds(window: tauri::Window, scale: f64) -> Result<WalkBounds, String> {
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let sf = window.scale_factor().map_err(|e| e.to_string())?;
    let (min_x, min_y, max_x, max_y) = combined_full_area(&window)?;
    let (off_x, off_y, content) =
        content_box(size.width as f64, size.height as f64, scale, sf);
    Ok(WalkBounds {
        min_x: min_x as f64 - off_x,
        min_y: min_y as f64 - off_y,
        max_x: max_x as f64 - content - off_x,
        max_y: max_y as f64 - content - off_y,
    })
}
