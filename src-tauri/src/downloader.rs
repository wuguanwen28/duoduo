//! 默认资源包下载：复用 updater 的流式下载能力，下到用户选定目录。
//!
//! 与热更新区别：
//! - 不做 sha256 校验（资源包不参与三源一致性，内容固定，仅作首装素材）。
//! - 只下载 zip 文件，不解压、不设资源根--解压与目录选择留给用户。
//! - 进度事件用独立名 `resources-download://progress`，避免与 `update://progress` 串扰。

use std::path::PathBuf;

use tauri::Emitter;

/// 默认资源包下载直链：内容不随版本变，只存于首版 v0.1.0。
const RESOURCES_URL: &str =
    "https://gitee.com/wuguanwen28/duoduo/releases/download/v0.1.0/duoduo-resources.zip";

/// 下载默认资源包到用户选定目录，返回保存后的 zip 文件绝对路径。
/// 进度通过 `resources-download://progress` 事件下发（{ downloaded, total }）。
#[tauri::command]
pub async fn pet_download_resources(
    app: tauri::AppHandle,
    dest_dir: String,
) -> Result<String, String> {
    use std::io::Write;
    let dest = PathBuf::from(&dest_dir);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let zip_path = dest.join("duoduo-resources.zip");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("duoduo-updater")
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(RESOURCES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "resources-download://progress",
            serde_json::json!({ "downloaded": downloaded, "total": total }),
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(zip_path.display().to_string())
}
