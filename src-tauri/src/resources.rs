//! 外置资源：资源根定位与持久化、扫描帧、manifest 读写、目录树列举。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri::Manager;

/// 用户选定的资源目录持久化文件（存于系统 AppData 配置目录下，单行绝对路径）。
fn resource_path_config(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("resource_path.txt"))
}

/// 读取持久化的用户选定资源目录；文件不存在/为空/目录已失效时返回 None。
fn read_saved_resource_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let cfg = resource_path_config(app)?;
    let text = std::fs::read_to_string(&cfg).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let p = PathBuf::from(trimmed);
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// 把用户选定的资源目录写入 AppData 配置（下次启动仍生效）。
fn write_saved_resource_root(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    let cfg = resource_path_config(app)
        .ok_or_else(|| "无法定位配置目录".to_string())?;
    if let Some(parent) = cfg.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&cfg, dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}

/// 外置资源根目录的定位优先级：
/// 1) 环境变量 `DUODUO_RESOURCES`（手动覆盖，便于调试/多套素材）；
/// 2) AppData 持久化的用户选定目录（设置页「更换目录」写入）；
/// 3) 开发模式（debug）：项目根下的 `resources/`；
/// 4) 发布模式：exe 同级的 `resources/`。
pub fn resource_root(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("DUODUO_RESOURCES") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Some(p) = read_saved_resource_root(app) {
        return p;
    }
    #[cfg(debug_assertions)]
    {
        // 开发模式下 CARGO_MANIFEST_DIR 指向 src-tauri，其父目录即项目根。
        if let Some(root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            return root.join("resources");
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("resources");
        }
    }
    PathBuf::from("resources")
}

/// 受支持的帧图片扩展名（统一按小写比较）。
const FRAME_EXTS: [&str; 6] = ["webp", "png", "jpg", "jpeg", "gif", "bmp"];

/// 列出某动作目录下、按文件名排序的帧文件绝对路径。
/// `dir` 是绝对路径时直接使用，否则拼接到资源根下。
fn list_frames(root: &Path, dir: &str) -> Vec<PathBuf> {
    let p = Path::new(dir);
    let full = if p.is_absolute() { p.to_path_buf() } else { root.join(p) };
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&full) {
        for e in entries.flatten() {
            let path = e.path();
            if !path.is_file() {
                continue;
            }
            let ok = path
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| FRAME_EXTS.contains(&x.to_lowercase().as_str()))
                .unwrap_or(false);
            if ok {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// `pet_scan_resources` 的返回结构。
#[derive(serde::Serialize)]
pub struct ScanResult {
    /// 资源根目录的绝对路径（便于前端展示/排错）。
    root: String,
    /// manifest.json 原样返回，强类型解析放在前端做。
    manifest: serde_json::Value,
    /// 动作名 → 帧文件绝对路径数组；跟随帧用特殊键 `"follow"`。
    frames: HashMap<String, Vec<String>>,
    /// 出错信息：读不到或解析失败时填入，前端据此显示「缺资源引导」。
    error: Option<String>,
}

/// 扫描外置资源：读取 manifest.json，按 follow / actions 里各自的 `dir`
/// 列出帧文件绝对路径，并把这些目录加入 asset 协议白名单，使前端能用
/// `convertFileSrc` 直接加载磁盘上的图片。一次性返回，减少前后端往返。
#[tauri::command]
pub fn pet_scan_resources(app: tauri::AppHandle) -> ScanResult {
    let root = resource_root(&app);
    let root_str = root.display().to_string();
    let manifest_path = root.join("manifest.json");

    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) => {
            return ScanResult {
                root: root_str,
                manifest: serde_json::Value::Null,
                frames: HashMap::new(),
                error: Some(format!(
                    "读不到 manifest.json（{}）：{e}",
                    manifest_path.display()
                )),
            }
        }
    };
    let manifest: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            return ScanResult {
                root: root_str,
                manifest: serde_json::Value::Null,
                frames: HashMap::new(),
                error: Some(format!("manifest.json 解析失败：{e}")),
            }
        }
    };

    // 资源根递归加入 asset 白名单；绝对路径的动作目录下面再逐个补授权。
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&root, true);

    // 先汇总所有 (键, 目录)，再统一扫描，避免闭包对 frames 的可变借用冲突。
    let mut dirs: Vec<(String, String)> = Vec::new();
    if let Some(dir) = manifest
        .get("follow")
        .and_then(|f| f.get("dir"))
        .and_then(|d| d.as_str())
    {
        dirs.push(("follow".to_string(), dir.to_string()));
    }
    if let Some(actions) = manifest.get("actions").and_then(|a| a.as_object()) {
        for (name, def) in actions {
            if let Some(dir) = def.get("dir").and_then(|d| d.as_str()) {
                dirs.push((name.clone(), dir.to_string()));
            }
        }
    }

    let mut frames: HashMap<String, Vec<String>> = HashMap::new();
    for (key, dir) in dirs {
        if Path::new(&dir).is_absolute() {
            let _ = scope.allow_directory(Path::new(&dir), false);
        }
        let paths = list_frames(&root, &dir);
        frames.insert(
            key,
            paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
        );
    }

    ScanResult {
        root: root_str,
        manifest,
        frames,
        error: None,
    }
}

/// `pet_read_manifest` 的返回结构。
#[derive(serde::Serialize)]
pub struct ManifestFile {
    /// 资源根目录绝对路径。
    root: String,
    /// manifest.json 的绝对路径。
    path: String,
    /// 文件文本内容；不存在时为空串。
    content: String,
    /// 文件是否已存在。
    exists: bool,
}

/// 读取资源根目录下的 manifest.json 原文（供设置窗编辑）。不存在不报错，
/// 返回 exists=false + 空内容，由前端给出默认模板。
#[tauri::command]
pub fn pet_read_manifest(app: tauri::AppHandle) -> ManifestFile {
    let root = resource_root(&app);
    let path = root.join("manifest.json");
    let exists = path.is_file();
    let content = if exists {
        std::fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };
    ManifestFile {
        root: root.display().to_string(),
        path: path.display().to_string(),
        content,
        exists,
    }
}

/// 把内容写回资源根目录下的 manifest.json（目录不存在则创建）。
/// 「没有就直接创建」即由此实现。
#[tauri::command]
pub fn pet_write_manifest(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let root = resource_root(&app);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(root.join("manifest.json"), content).map_err(|e| e.to_string())
}

/// 资源根下没有 manifest.json 时写入的空白模板。用户更换目录到空文件夹后由
/// `pet_set_resource_root` 自动创建，使其能在设置页从零配置动作/行为。
const BLANK_MANIFEST: &str = r#"{
  "version": 1,
  "follow": { "dir": "follow", "clockwise": true, "startAngle": 0 },
  "actions": {},
  "behaviors": {}
}
"#;

/// 设置用户选定的资源目录：校验目录 → 写入 AppData 持久化 → 若缺 manifest.json
/// 则创建空白模板 → 返回采用后的资源根绝对路径。
#[tauri::command]
pub fn pet_set_resource_root(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = PathBuf::from(path.trim());
    if dir.as_os_str().is_empty() {
        return Err("目录路径为空".into());
    }
    if !dir.is_dir() {
        return Err(format!("目录不存在：{}", dir.display()));
    }
    write_saved_resource_root(&app, &dir)?;
    // 缺 manifest.json 就创建空白模板，让用户能直接进设置页配置。
    let manifest = dir.join("manifest.json");
    if !manifest.is_file() {
        std::fs::write(&manifest, BLANK_MANIFEST)
            .map_err(|e| format!("创建 manifest.json 失败：{e}"))?;
    }
    Ok(dir.display().to_string())
}

/// 返回当前生效的资源根目录绝对路径（设置页顶栏展示用）。
#[tauri::command]
pub fn pet_get_resource_root(app: tauri::AppHandle) -> String {
    resource_root(&app).display().to_string()
}

/// 目录树节点：`label` 为目录名，`value` 为相对资源根的 POSIX 风格相对路径。
#[derive(serde::Serialize)]
pub struct DirNode {
    label: String,
    value: String,
    children: Vec<DirNode>,
}

/// 递归列出 `dir` 下的子目录，`rel` 是相对资源根的前缀路径（用 `/` 分隔）。
/// 跳过隐藏目录（`.` 开头）；限制递归深度避免异常深目录。
fn list_subdirs(dir: &Path, rel: &str, depth: usize) -> Vec<DirNode> {
    if depth == 0 {
        return Vec::new();
    }
    let mut out: Vec<DirNode> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let path = e.path();
            if !path.is_dir() {
                continue;
            }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) if !n.starts_with('.') => n.to_string(),
                _ => continue,
            };
            let value = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let children = list_subdirs(&path, &value, depth - 1);
            out.push(DirNode {
                label: name,
                value,
                children,
            });
        }
    }
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// 以资源根为根，递归列出所有子目录，供设置页的目录树形下拉使用。
/// 根目录不存在/不可读时返回空数组（不报错）。
#[tauri::command]
pub fn pet_list_dirs(app: tauri::AppHandle) -> Vec<DirNode> {
    let root = resource_root(&app);
    list_subdirs(&root, "", 8)
}
