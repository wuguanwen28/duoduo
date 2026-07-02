//! 用户反馈提交：把前端压缩后的文本 + 图片用 multipart POST 到自建服务器。

use std::time::Duration;

use reqwest::multipart;

use crate::config::SERVER_BASE;

/// 前端传入的反馈载荷。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPayload {
    /// 反馈类型："feature" | "bug" | "other"
    #[serde(rename = "type")]
    pub kind: String,
    /// 正文
    pub content: String,
    /// 可选联系方式
    pub contact: Option<String>,
    /// 已压缩图片字节（每张一个 Vec<u8>）
    pub images: Vec<Vec<u8>>,
    /// 对应 mime，如 "image/webp"
    pub mime: Vec<String>,
}

/// 提交反馈到 `${SERVER_BASE}/api/feedback`。
#[tauri::command]
pub async fn pet_submit_feedback(payload: FeedbackPayload) -> Result<(), String> {
    submit(payload).await.map_err(|e| e.to_string())
}

/// 按 mime 推导扩展名。
fn ext_of(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        // webp 及其它一律 webp（前端默认编码 webp）
        _ => "webp",
    }
}

async fn submit(p: FeedbackPayload) -> Result<(), Box<dyn std::error::Error>> {
    let mut form = multipart::Form::new()
        .text("type", p.kind.clone())
        .text("content", p.content.clone());
    if let Some(c) = p.contact.as_ref() {
        form = form.text("contact", c.clone());
    }
    // appVer / os 由后端从 exe 取不到，前端不便注入，这里用编译期版本 + 运行时 OS。
    form = form.text("appVer", env!("CARGO_PKG_VERSION").to_string());
    form = form.text("os", std::env::consts::OS.to_string());

    for (i, bytes) in p.images.iter().enumerate() {
        let mime = p.mime.get(i).map(|s| s.as_str()).unwrap_or("image/webp");
        let part = multipart::Part::bytes(bytes.clone())
            .file_name(format!("image_{i}.{}", ext_of(mime)))
            .mime_str(mime)?;
        form = form.part("images", part);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let url = format!("{}/api/feedback", SERVER_BASE);
    let resp = client.post(&url).multipart(form).send().await?;
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("服务器返回 {status}: {text}").into())
    }
}
