//! 视频转 WebP 帧 —— 后端只负责落盘。解码 / 抠图 / WebP 编码全部在前端
//! （WebView2 的 `<video>` 解码 + Canvas 处理 + `toBlob('image/webp')`）完成，
//! 这里提供两个命令：准备输出目录、把单帧字节写到资源目录子文件夹下。

use std::path::{Component, Path, PathBuf};

use crate::resources::resource_root;

/// 校验并规整子目录：必须是相对路径，且不含 `..` 等逃逸成分。
fn sanitize_subdir(subdir: &str) -> Result<PathBuf, String> {
    let p = Path::new(subdir.trim());
    if p.as_os_str().is_empty() {
        return Err("子目录名不能为空".into());
    }
    if p.is_absolute() {
        return Err("子目录必须是相对资源根的路径".into());
    }
    for comp in p.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err("子目录不能包含 .. 等特殊路径成分".into()),
        }
    }
    Ok(p.to_path_buf())
}

/// 准备输出目录：在当前资源根下创建 `subdir`，可选清空其中已有的 .webp，
/// 返回该目录的绝对路径（供后续 `pet_converter_write` 写入）。
#[tauri::command]
pub fn pet_converter_begin(
    app: tauri::AppHandle,
    subdir: String,
    clear: bool,
) -> Result<String, String> {
    let rel = sanitize_subdir(&subdir)?;
    let dir = resource_root(&app).join(&rel);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if clear {
        // 清掉旧的 .webp，避免新旧帧数不同导致序列错乱。
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let p = e.path();
                let is_webp = p
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("webp"))
                    .unwrap_or(false);
                if is_webp {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
    }
    Ok(dir.display().to_string())
}

/// 把单帧 WebP 字节写入 `dir`（须为 `pet_converter_begin` 返回的目录）下的 `name`。
/// `name` 必须是纯文件名（不含路径分隔符），避免越权写到目录外。
#[tauri::command]
pub fn pet_converter_write(dir: String, name: String, data: Vec<u8>) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("非法文件名".into());
    }
    let base = Path::new(&dir);
    if !base.is_dir() {
        return Err(format!("输出目录不存在：{dir}"));
    }
    std::fs::write(base.join(&name), &data).map_err(|e| e.to_string())
}
