//! 视频转 WebP 帧 —— 后端只负责落盘。解码 / 抠图 / WebP 编码全部在前端
//! （WebView2 的 `<video>` 解码 + Canvas 处理 + `toBlob('image/webp')`）完成，
//! 这里提供两个命令：准备输出目录、把单帧字节写到指定目录下。
//!
//! 输出目录由前端用系统目录选择器确定（默认 `<视频所在目录>/<视频名>_帧图片`），
//! 后端不再限定在资源根下；只校验路径合法、创建目录、可选清掉旧 `.webp`。

use std::path::{Path, PathBuf};

/// 准备输出目录：创建（不存在则建），可选清空其中已有的 .webp，
/// 返回该目录的绝对路径（供后续 `pet_converter_write` 写入）。
///
/// `dir` 为用户自选的绝对路径；仅拒绝空串与含 `..` 逃逸成分的路径，不再强制相对资源根。
#[tauri::command]
pub fn pet_converter_begin(dir: String, clear: bool) -> Result<String, String> {
    let p = PathBuf::from(dir.trim());
    if p.as_os_str().is_empty() {
        return Err("输出目录不能为空".into());
    }
    // 拒绝 `..` 逃逸成分，避免用户粘贴恶意相对路径越权；绝对路径正常放行。
    for comp in p.components() {
        if !matches!(comp, std::path::Component::Normal(_) | std::path::Component::RootDir | std::path::Component::Prefix(_)) {
            return Err("输出目录不能包含 .. 等特殊路径成分".into());
        }
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    if clear {
        // 清掉旧的 .webp，避免新旧帧数不同导致序列错乱。
        if let Ok(entries) = std::fs::read_dir(&p) {
            for e in entries.flatten() {
                let path = e.path();
                let is_webp = path
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("webp"))
                    .unwrap_or(false);
                if is_webp {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
    Ok(p.display().to_string())
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
