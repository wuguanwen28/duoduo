//! duoduo 热更新：拉 version.json（三源 fallback）、流式下载新 exe（进度事件）、
//! sha256 校验、Windows 改名腾位自替换、启动清理残留旧 exe。
//!
//! 下载源地址由 `manifest_urls()` / `exe_urls()` 按优先级提供（Gitee → GitHub → 自建服务器）。
//! 其中自建服务器基址为 `SERVER_BASE` 常量——当前为占位值，发布前必须替换为真实域名。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::state::{DownloadState, PetState};

/// 当前正在执行的下载任务（用于取消与并发控制）。
struct ActiveDownload {
    id: u64,
    cancel: Arc<AtomicBool>,
}

static CURRENT_DOWNLOAD: Mutex<Option<ActiveDownload>> = Mutex::new(None);
static DOWNLOAD_ID_SEQ: AtomicU64 = AtomicU64::new(1);

/// 下载成功后的返回结构。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub download_id: u64,
}

/** 将下载进度写回共享状态，供设置窗口重开时恢复。 */
fn set_download_progress(app: &tauri::AppHandle, progress: u8) {
    if let Ok(mut guard) = app.state::<PetState>().download.lock() {
        guard.progress = progress;
    }
}

/** 标记下载已开始，清空旧路径与进度。 */
fn set_download_started(app: &tauri::AppHandle, id: u64, version: &str) {
    if let Ok(mut guard) = app.state::<PetState>().download.lock() {
        guard.is_downloading = true;
        guard.download_id = id;
        guard.progress = 0;
        guard.downloaded_path = None;
        guard.latest_version = Some(version.to_string());
    }
}

/** 标记下载已完成，持久化路径并通知小猫窗口。 */
fn set_download_completed(app: &tauri::AppHandle, path: &str) {
    if let Ok(mut guard) = app.state::<PetState>().download.lock() {
        guard.is_downloading = false;
        guard.progress = 100;
        guard.downloaded_path = Some(path.to_string());
    }
    let _ = app.emit(
        "update://completed",
        serde_json::json!({ "path": path }),
    );
}

/** 标记下载已结束（取消或失败），清空下载中标志。 */
fn set_download_finished(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<PetState>().download.lock() {
        guard.is_downloading = false;
        if guard.downloaded_path.is_none() {
            guard.progress = 0;
        }
    }
}

/// 计算字节的 sha256，返回 64 位小写十六进制字符串。
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(serde::Deserialize, Clone)]
pub struct ExeInfo {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(serde::Deserialize, Clone)]
pub struct VersionManifest {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    // 发布日期：从 version.json 解析保留，目前仅作元数据、未在 UI 展示。
    #[serde(default, rename = "pubDate")]
    #[allow(dead_code)]
    pub pub_date: String,
    pub exe: ExeInfo,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub has_update: bool,
    pub current: String,
    pub latest: String,
    pub notes: String,
}

/// 解析 "x.y.z" 为 (主, 次, 修订)，任一段非数字则返回 None。
fn parse_semver(v: &str) -> Option<(u32, u32, u32)> {
    let mut it = v.trim().trim_start_matches('v').split('.');
    let a = it.next()?.parse().ok()?;
    let b = it.next()?.parse().ok()?;
    let c = it.next()?.parse().ok()?;
    Some((a, b, c))
}

/// latest 是否严格新于 current。任一无法解析时保守返回 false（不提示更新）。
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// 占位服务器基址——发布前替换为真实服务器域名。
/// 仅影响三源 fallback 的第三优先级（自建服务器），Gitee/GitHub 源不依赖此值。
const SERVER_BASE: &str = "https://example.com";

/// 三源的 version.json 地址（与版本号无关），按优先级排序。
pub fn manifest_urls() -> Vec<(&'static str, String)> {
    vec![
        ("gitee", "https://gitee.com/wuguanwen28/duoduo/raw/master/version.json".into()),
        ("github", "https://github.com/wuguanwen28/duoduo/releases/latest/download/version.json".into()),
        ("server", format!("{SERVER_BASE}/duoduo/version.json")),
    ]
}

/// 三源的 exe 下载地址（按版本号拼），按优先级排序。
pub fn exe_urls(version: &str, exe_name: &str) -> Vec<(&'static str, String)> {
    let v = version.trim().trim_start_matches('v');
    vec![
        ("gitee", format!("https://gitee.com/wuguanwen28/duoduo/releases/download/v{v}/{exe_name}")),
        ("github", format!("https://github.com/wuguanwen28/duoduo/releases/download/v{v}/{exe_name}")),
        ("server", format!("{SERVER_BASE}/duoduo/v{v}/{exe_name}")),
    ]
}

/// 依次尝试三源 GET version.json，返回首个解析成功的清单。
async fn fetch_manifest() -> Result<VersionManifest, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        // 显式 UA：GitHub raw/release 端点对匿名默认 UA 偶发 403。
        .user_agent("duoduo-updater")
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_err = String::from("无可用更新源");
    for (name, url) in manifest_urls() {
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(body) => match serde_json::from_str::<VersionManifest>(&body) {
                    Ok(m) => {
                        println!("[duoduo updater] 使用清单源: {name} ({url})");
                        return Ok(m);
                    }
                    Err(e) => last_err = format!("[{name}] 解析 version.json 失败：{e}"),
                },
                Err(e) => last_err = format!("[{name}] 读取响应失败：{e}"),
            },
            Ok(resp) => last_err = format!("[{name}] HTTP {}", resp.status()),
            Err(e) => last_err = format!("[{name}] 请求失败：{e}"),
        }
    }
    Err(last_err)
}

/// 当前 exe 所在目录。
fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法定位 exe 目录".to_string())
}

/// 当前 exe 完整路径（仅发布模式的自替换流程 `pet_update_apply` 用到，
/// 故用 cfg 限定，避免开发模式编译出未使用函数的 dead_code 警告）。
#[cfg(not(debug_assertions))]
fn current_exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

/// 新版临时文件路径：<exe目录>/duoduo.exe.new
fn new_exe_path() -> Result<PathBuf, String> {
    Ok(exe_dir()?.join("duoduo.exe.new"))
}

/// 旧版备份路径：<exe目录>/duoduo.exe.old
fn old_exe_path() -> Result<PathBuf, String> {
    Ok(exe_dir()?.join("duoduo.exe.old"))
}

/// 从单个 URL 流式下载到 dest，边下边发进度事件。
async fn download_to(
    app: &tauri::AppHandle,
    url: &str,
    dest: &PathBuf,
    expect_total: u64,
    download_id: u64,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use std::io::Write;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        // 显式 UA：GitHub raw/release 端点对匿名默认 UA 偶发 403。
        .user_agent("duoduo-updater")
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(expect_total);
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if cancel.load(Ordering::SeqCst) {
            return Err("下载已取消".into());
        }
        // 若新下载已接管 CURRENT_DOWNLOAD，旧任务也应退出，避免多任务并发。
        let current_id = CURRENT_DOWNLOAD
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|d| d.id));
        if current_id != Some(download_id) {
            return Err("下载已取消".into());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };
        set_download_progress(app, pct);
        let _ = app.emit(
            "update://progress",
            serde_json::json!({
                "downloaded": downloaded,
                "total": total,
                "downloadId": download_id,
            }),
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// 清理当前下载登记：只有传入的 id 仍匹配时才置空，避免误删新任务。
fn clear_current_download(id: u64) {
    if let Ok(mut guard) = CURRENT_DOWNLOAD.lock() {
        if guard.as_ref().map(|d| d.id) == Some(id) {
            *guard = None;
        }
    }
}

/// 下载新版 exe：三源 fallback + sha256 校验，成功返回 .new 路径与本次下载 id。
/// 若已有下载在跑，会先将其取消，确保同一时刻只有一个活跃下载任务。
#[tauri::command]
pub async fn pet_update_download(app: tauri::AppHandle) -> Result<DownloadResult, String> {
    let m = fetch_manifest().await?;
    let id = DOWNLOAD_ID_SEQ.fetch_add(1, Ordering::SeqCst);
    let cancel = Arc::new(AtomicBool::new(false));

    {
        let mut guard = CURRENT_DOWNLOAD.lock().map_err(|e| e.to_string())?;
        // 取消可能还在收尾的旧下载，避免新旧任务并发导致进度事件混乱。
        if let Some(prev) = guard.as_ref() {
            prev.cancel.store(true, Ordering::SeqCst);
        }
        *guard = Some(ActiveDownload { id, cancel: cancel.clone() });
    }

    // 立即通知前端本次下载的 id，便于前端过滤旧任务的迟到进度事件。
    let _ = app.emit(
        "update://started",
        serde_json::json!({ "downloadId": id }),
    );

    set_download_started(&app, id, &m.version);

    let dest = new_exe_path()?;
    let mut last_err = String::from("所有下载源均失败");
    for (name, url) in exe_urls(&m.version, &m.exe.name) {
        match download_to(&app, &url, &dest, m.exe.size, id, &cancel).await {
            Ok(()) => {
                let bytes = std::fs::read(&dest).map_err(|e| e.to_string())?;
                if sha256_hex(&bytes).eq_ignore_ascii_case(&m.exe.sha256) {
                    println!("[duoduo updater] 使用下载源: {name} ({url})");
                    let path = dest.display().to_string();
                    set_download_completed(&app, &path);
                    clear_current_download(id);
                    return Ok(DownloadResult {
                        path,
                        download_id: id,
                    });
                }
                let _ = std::fs::remove_file(&dest);
                last_err = format!("[{name}] sha256 校验不匹配");
            }
            Err(e) => {
                let _ = std::fs::remove_file(&dest);
                if e == "下载已取消" {
                    set_download_finished(&app);
                    clear_current_download(id);
                    return Err(e);
                }
                last_err = format!("[{name}] {e}");
            }
        }
    }
    set_download_finished(&app);
    clear_current_download(id);
    Err(last_err)
}

/// 取消正在进行的下载。前端调用后，当前活跃任务的按块检查会立即退出。
#[tauri::command]
pub fn pet_update_cancel() {
    if let Ok(guard) = CURRENT_DOWNLOAD.lock() {
        if let Some(d) = guard.as_ref() {
            d.cancel.store(true, Ordering::SeqCst);
        }
    }
}

/// 查询当前下载状态，供设置窗口重开时恢复。
#[tauri::command]
pub fn pet_update_status(app: tauri::AppHandle) -> DownloadState {
    app.state::<PetState>()
        .download
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

/// 应用更新：改名腾位（运行中的 exe 可被改名）→ 启动新 exe → 退出当前进程。
/// 发布模式专用；开发模式禁用以免误删 target 下的 exe。
#[tauri::command]
pub async fn pet_update_apply(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = &app;
        return Err("开发模式禁用自替换（请在发布版中测试）".into());
    }
    #[cfg(not(debug_assertions))]
    {
        let cur = current_exe_path()?;
        let newp = new_exe_path()?;
        let oldp = old_exe_path()?;
        if !newp.exists() {
            return Err("未找到已下载的新版本，请先下载".into());
        }
        // 清掉上次残留的 .old（若有）。
        if oldp.exists() {
            let _ = std::fs::remove_file(&oldp);
        }
        // 关键三步：当前 exe → .old，新 exe → 正式名，再启动新进程。
        std::fs::rename(&cur, &oldp).map_err(|e| format!("备份旧 exe 失败：{e}"))?;
        if let Err(e) = std::fs::rename(&newp, &cur) {
            // 回滚：把 .old 改回来，避免没有可用 exe。回滚也失败时（极窄
            // 窗口，如杀软锁文件），给出手动恢复指引——此时 .old/.new 仍在盘上。
            if let Err(re) = std::fs::rename(&oldp, &cur) {
                return Err(format!(
                    "替换新 exe 失败：{e}；自动回滚也失败：{re}。\
                     请手动把同目录下的 duoduo.exe.old 改名回 duoduo.exe 以恢复。"
                ));
            }
            return Err(format!("替换新 exe 失败（已回滚到旧版本）：{e}"));
        }
        std::process::Command::new(&cur)
            .spawn()
            .map_err(|e| format!("启动新版本失败：{e}"))?;
        app.exit(0);
        Ok(())
    }
}

/// 启动时清理上次更新残留的 duoduo.exe.old（忽略错误：可能仍被短暂占用）。
pub fn cleanup_old_exe() {
    if let Ok(oldp) = old_exe_path() {
        if oldp.exists() {
            let _ = std::fs::remove_file(&oldp);
        }
    }
}

/// 返回当前 exe 的版本号（编译期常量，纯本地、零网络）。
///
/// 与 `pet_update_check` 共用 `CARGO_PKG_VERSION` 这一来源，保证「界面显示的版本」
/// 和「更新比较用的版本」永远一致；前端进面板时先调它秒填版本，再异步去查更新。
#[tauri::command]
pub fn pet_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 检查更新：三源拉 version.json，与当前版本比较。
#[tauri::command]
pub async fn pet_update_check() -> Result<CheckResult, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let m = fetch_manifest().await?;
    Ok(CheckResult {
        has_update: is_newer(&m.version, &current),
        current,
        latest: m.version,
        notes: m.notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_detects_upgrade() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.2.10", "0.2.9")); // 数字比较，非字典序
    }

    #[test]
    fn newer_rejects_same_or_older() {
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
    }

    #[test]
    fn newer_rejects_garbage() {
        assert!(!is_newer("abc", "0.1.0"));
        assert!(!is_newer("0.1", "0.1.0"));
    }

    #[test]
    fn manifest_urls_order_and_shape() {
        let urls = manifest_urls();
        assert_eq!(urls.len(), 3);
        assert_eq!(urls[0].0, "gitee");
        assert!(urls[0].1.ends_with("/raw/master/version.json"));
        assert!(urls[1].1.contains("releases/latest/download/version.json"));
    }

    #[test]
    fn exe_urls_embed_version() {
        let urls = exe_urls("0.2.0", "duoduo.exe");
        assert_eq!(urls[0].0, "gitee");
        assert!(urls[0].1.contains("/download/v0.2.0/duoduo.exe"));
        // 容忍带前导 v 的版本号
        assert!(exe_urls("v0.2.0", "duoduo.exe")[1].1.contains("/v0.2.0/duoduo.exe"));
    }

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
