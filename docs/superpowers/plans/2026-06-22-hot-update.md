# 多多 热更新功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为绿色版裸 exe 的 duoduo 加上应用内热更新：启动静默检查 + 设置里手动检查，从 Gitee/GitHub/自建服务器三源 fallback 下载新 exe，校验后用「改名腾位」自替换并重启。

**Architecture:** 后端新增 `updater.rs` 模块，负责拉 `version.json`（三源 fallback）、流式下载 exe（进度事件）、sha256 校验、Windows 改名腾位自替换。前端在设置窗口新增「关于/更新」面板手动操作，主窗口启动时静默查一次、有新版显示轻提示。发布侧把打包脚本拆成「裸 exe + 资源 zip + version.json + 整合 zip」四产物，CI 自动发 GitHub，半自动脚本同步 Gitee + 服务器。

**Tech Stack:** Tauri 2 (Rust 2021) + Vue 3.5 `<script setup>` + Element Plus + Vite 6；新增 Rust 依赖 `reqwest`(rustls) 与 `sha2`；Node 脚本用内置 `crypto`。

## Global Constraints

- 只更新 `duoduo.exe`，**绝不触碰 `resources/`**（保护用户自定义素材）。
- 下载源优先级固定：**Gitee → GitHub → 服务器**（服务器兜底省带宽）。
- `version.json` 的获取地址必须**与版本号无关**；exe 下载地址才按版本号拼。
- 自替换仅在**发布模式**生效；`#[cfg(debug_assertions)]` 下禁用，避免误删 `target/` 里的 exe。
- 下载的 exe 必须 **sha256 校验通过**才允许替换。
- `src/` 下所有注释用中文文档注释（JSDoc `/** */` / `<!-- -->`）；符号名、路径、API 名保持原样。
- 自定义命令注册进 `invoke_handler` 即可，**无需改 capabilities**。
- 仓库归属：Gitee 与 GitHub 均为 `wuguanwen28/duoduo`。
- 提交信息用中文 conventional commits；功能提交用 `feat:`（会进 CHANGELOG）。

## 共享契约（所有任务共用，先读）

**version.json 格式**（CI 生成，作为 Release 资产 / 服务器固定路径文件）：

```jsonc
{
  "version": "0.2.0",
  "notes": "更新说明文本",
  "pubDate": "2026-06-22",
  "exe": { "name": "duoduo.exe", "size": 8123456, "sha256": "<64位小写hex>" }
}
```

**三源地址**（`updater.rs` 内常量与函数产出）：

| 源 | version.json（稳定、无版本号） | exe（带版本号 `v{ver}`） |
|---|---|---|
| Gitee | `https://gitee.com/wuguanwen28/duoduo/raw/master/version.json` | `https://gitee.com/wuguanwen28/duoduo/releases/download/v{ver}/duoduo.exe` |
| GitHub | `https://github.com/wuguanwen28/duoduo/releases/latest/download/version.json` | `https://github.com/wuguanwen28/duoduo/releases/download/v{ver}/duoduo.exe` |
| 服务器 | `{SERVER_BASE}/duoduo/version.json` | `{SERVER_BASE}/duoduo/v{ver}/duoduo.exe` |

`SERVER_BASE` 为占位常量 `https://example.com`，实现完后由老大替换为真实服务器域名。

**Rust 类型**（`updater.rs` 定义，跨任务引用）：

```rust
#[derive(serde::Deserialize, Clone)]
pub struct ExeInfo { pub name: String, pub size: u64, pub sha256: String }

#[derive(serde::Deserialize, Clone)]
pub struct VersionManifest {
    pub version: String,
    #[serde(default)] pub notes: String,
    #[serde(default, rename = "pubDate")] pub pub_date: String,
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
```

**前端事件**：下载进度事件名 `update://progress`，payload `{ downloaded: number, total: number }`。

**前端命令签名**（TS 侧 `invoke` 目标）：
- `pet_update_check(): Promise<CheckResult>` —— `{ hasUpdate, current, latest, notes }`
- `pet_update_download(): Promise<string>` —— 返回下载好的 `.new` 文件路径
- `pet_update_apply(): Promise<void>` —— 自替换并重启

---

## 文件结构

- 新建 `src-tauri/src/updater.rs` —— 后端热更新全部逻辑（检查/下载/校验/自替换/启动清理）。
- 修改 `src-tauri/src/lib.rs` —— 声明 `mod updater`、注册 3 命令、setup 里清理残留 `.old`。
- 修改 `src-tauri/Cargo.toml` —— 加 `reqwest`、`sha2` 依赖。
- 新建 `src/settings/update/UpdateSettings.vue` —— 「关于/更新」面板。
- 修改 `src/settings/SettingsApp.vue` —— 加导航项 + 路由分支。
- 修改 `src/components/Pet/Pet.vue` —— 启动静默检查 + 轻提示。
- 修改 `scripts/package.mjs` —— 产出拆分产物 + 生成 version.json。
- 修改 `.github/workflows/release.yml` —— 上传四产物。
- 新建 `scripts/publish-mirrors.mjs` + `package.json` 加 `publish:mirrors` 脚本 —— Gitee + 服务器同步。

---

## Task 1: 版本比较与 version.json 类型（纯逻辑，TDD）

**Files:**
- Create: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/lib.rs:11`（加 `mod updater;`）

**Interfaces:**
- Produces: `pub fn is_newer(latest: &str, current: &str) -> bool`；类型 `VersionManifest` / `ExeInfo` / `CheckResult`（见共享契约）。

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/updater.rs` 写入（先只放类型 + is_newer 占位 + 测试）：

```rust
//! duoduo 热更新：拉 version.json（三源 fallback）、流式下载新 exe（进度事件）、
//! sha256 校验、Windows 改名腾位自替换、启动清理残留旧 exe。

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
    #[serde(default, rename = "pubDate")]
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
}
```

在 `src-tauri/src/lib.rs` 第 11 行的 `mod converter;` 上方加一行 `mod updater;`（保持字母序可放 `mod tray;` 前，但与现有顺序一致即可）。

- [ ] **Step 2: 运行测试确认失败/通过**

Run: `cd src-tauri && cargo test updater::tests`
Expected: 编译通过，3 个测试 PASS（本任务实现已随测试一起给出，确认绿）。若 `mod updater;` 漏加会报 unresolved module。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat: 热更新版本比较与 version.json 类型"
```

---

## Task 2: 三源 URL 构建（纯逻辑，TDD）

**Files:**
- Modify: `src-tauri/src/updater.rs`

**Interfaces:**
- Produces: `pub fn manifest_urls() -> Vec<(&'static str, String)>`；`pub fn exe_urls(version: &str, exe_name: &str) -> Vec<(&'static str, String)>`（均按 Gitee→GitHub→服务器顺序）。

- [ ] **Step 1: 写失败测试**

在 `updater.rs` 的 `is_newer` 下方加入实现 + 在 `mod tests` 内加测试：

```rust
/// 占位服务器基址；实现完成后由老大替换为真实域名。
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
```

测试加入 `mod tests`：

```rust
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
```

- [ ] **Step 2: 运行测试**

Run: `cd src-tauri && cargo test updater::tests`
Expected: 全部 PASS（含新增 2 个）。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/updater.rs
git commit -m "feat: 热更新三源 URL 构建"
```

---

## Task 3: sha256 校验（纯逻辑，TDD）

**Files:**
- Modify: `src-tauri/src/updater.rs`, `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: `pub fn sha256_hex(bytes: &[u8]) -> String`（返回 64 位小写 hex）。

- [ ] **Step 1: 加依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 末尾加：

```toml
sha2 = "0.10"
```

- [ ] **Step 2: 写失败测试 + 实现**

在 `updater.rs` 加入：

```rust
use sha2::{Digest, Sha256};

/// 计算字节的 sha256，返回 64 位小写十六进制字符串。
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}
```

`mod tests` 加（标准测试向量）：

```rust
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
```

- [ ] **Step 3: 运行测试**

Run: `cd src-tauri && cargo test updater::tests`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/updater.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: 热更新 sha256 校验工具"
```

---

## Task 4: 拉取 manifest + 检查命令（I/O，build + 手动验证）

**Files:**
- Modify: `src-tauri/src/updater.rs`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs:41-61`

**Interfaces:**
- Consumes: `is_newer`、`manifest_urls`、`VersionManifest`、`CheckResult`。
- Produces: `#[tauri::command] pub async fn pet_update_check() -> Result<CheckResult, String>`；内部 `async fn fetch_manifest() -> Result<VersionManifest, String>`。

- [ ] **Step 1: 加依赖**

`src-tauri/Cargo.toml` `[dependencies]` 加（关闭默认 TLS，用 rustls 避免 OpenSSL）：

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
```

- [ ] **Step 2: 实现拉取 + 命令**

在 `updater.rs` 加入：

```rust
use tauri::Emitter;

/// 依次尝试三源 GET version.json，返回首个解析成功的清单。
async fn fetch_manifest() -> Result<VersionManifest, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_err = String::from("无可用更新源");
    for (name, url) in manifest_urls() {
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(body) => match serde_json::from_str::<VersionManifest>(&body) {
                    Ok(m) => return Ok(m),
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
```

> 注：`use tauri::Emitter;` 供后续任务的进度事件用，本任务先引入不报未使用（若 cargo 警告未使用可暂留，Task 5 即用到）。如介意警告，可在 Task 5 再加该 use。

- [ ] **Step 3: 注册命令**

`src-tauri/src/lib.rs` 的 `invoke_handler` 数组里，`icon::pet_reset_icon` 后加（注意逗号）：

```rust
            icon::pet_reset_icon,
            updater::pet_update_check
```

- [ ] **Step 4: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（reqwest/sha2 首次拉取依赖会较慢）。

- [ ] **Step 5: 手动验证（可选但推荐）**

临时在本机起一个静态服务器放一个 version.json，或先把 `SERVER_BASE` 指向可达地址；运行 `pnpm app:dev`，在浏览器/前端控制台 `await window.__TAURI__.core.invoke('pet_update_check')` 观察返回 `{hasUpdate,current,latest,notes}` 或明确错误字符串。无现成源时，确认报错文案为「[gitee] …」链式说明即可。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: 热更新检查命令 pet_update_check（三源 fallback）"
```

---

## Task 5: 下载 exe + 进度事件 + sha256 校验（I/O）

**Files:**
- Modify: `src-tauri/src/updater.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `fetch_manifest`、`exe_urls`、`sha256_hex`、`ExeInfo`。
- Produces: `#[tauri::command] pub async fn pet_update_download(app: tauri::AppHandle) -> Result<String, String>`；事件 `update://progress`。辅助 `fn exe_dir() -> Result<PathBuf,String>`、`fn new_exe_path() -> Result<PathBuf,String>`。

- [ ] **Step 1: 实现路径辅助 + 下载**

在 `updater.rs` 加入：

```rust
use std::path::PathBuf;

/// 当前 exe 所在目录。
fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法定位 exe 目录".to_string())
}

/// 当前 exe 完整路径。
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
) -> Result<(), String> {
    use std::io::Write;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
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
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "update://progress",
            serde_json::json!({ "downloaded": downloaded, "total": total }),
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// 下载新版 exe：三源 fallback + sha256 校验，成功返回 .new 路径。
#[tauri::command]
pub async fn pet_update_download(app: tauri::AppHandle) -> Result<String, String> {
    let m = fetch_manifest().await?;
    let dest = new_exe_path()?;
    let mut last_err = String::from("所有下载源均失败");
    for (name, url) in exe_urls(&m.version, &m.exe.name) {
        match download_to(&app, &url, &dest, m.exe.size).await {
            Ok(()) => {
                let bytes = std::fs::read(&dest).map_err(|e| e.to_string())?;
                if sha256_hex(&bytes).eq_ignore_ascii_case(&m.exe.sha256) {
                    return Ok(dest.display().to_string());
                }
                let _ = std::fs::remove_file(&dest);
                last_err = format!("[{name}] sha256 校验不匹配");
            }
            Err(e) => {
                let _ = std::fs::remove_file(&dest);
                last_err = format!("[{name}] {e}");
            }
        }
    }
    Err(last_err)
}
```

- [ ] **Step 2: 注册命令**

`lib.rs` 的 `invoke_handler` 里 `updater::pet_update_check` 后加：

```rust
            updater::pet_update_check,
            updater::pet_update_download
```

- [ ] **Step 3: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，无未使用警告（`Emitter`、`PathBuf` 均已用到）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat: 热更新下载命令 pet_update_download（进度+校验）"
```

---

## Task 6: 自替换 + 启动清理（I/O，谨慎手动验证）

**Files:**
- Modify: `src-tauri/src/updater.rs`, `src-tauri/src/lib.rs:41-61,93-119`

**Interfaces:**
- Consumes: `current_exe_path`、`new_exe_path`、`old_exe_path`。
- Produces: `#[tauri::command] pub async fn pet_update_apply(app: tauri::AppHandle) -> Result<(), String>`；`pub fn cleanup_old_exe()`。

- [ ] **Step 1: 实现自替换 + 清理**

在 `updater.rs` 加入：

```rust
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
            // 回滚：把 .old 改回来，避免没有可用 exe。
            let _ = std::fs::rename(&oldp, &cur);
            return Err(format!("替换新 exe 失败：{e}"));
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
```

- [ ] **Step 2: 注册命令 + setup 调用清理**

`lib.rs` `invoke_handler` 里 `updater::pet_update_download` 后加：

```rust
            updater::pet_update_download,
            updater::pet_update_apply
```

`lib.rs` 的 `.setup(|app| {` 块内、`icon::load_custom_icon(app.handle());` 之后、`Ok(())` 之前加：

```rust
            // 清理上次热更新残留的旧 exe。
            updater::cleanup_old_exe();
```

- [ ] **Step 3: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。dev 模式下 `pet_update_apply` 走 `#[cfg(debug_assertions)]` 分支，`cur/newp/oldp` 仅在 release 分支用到——若 cargo 报这些函数 dead_code（仅 debug 构建时），属预期；可对 `current_exe_path`/`old_exe_path` 加 `#[allow(dead_code)]` 或忽略 debug 构建的该警告。

- [ ] **Step 4: 手动验证（发布构建）**

构建发布版：`pnpm app:build`（注意此步依赖 Task 10 的打包脚本；若 Task 10 未做，可临时 `cd src-tauri && cargo build --release` 只验证 exe 行为）。把 release exe 拷到一个测试目录，旁边放 `duoduo.exe.new`（随便一个可执行 exe 改名即可，仅验证替换流程），运行后触发 apply，确认：当前 exe 被改名为 `.old`、`.new` 顶上、新进程拉起、旧进程退出；重启后 `.old` 被清理。**全程 resources/ 不受影响。**

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat: 热更新自替换 pet_update_apply 与启动清理"
```

---

## Task 7: 「关于/更新」设置面板（前端，typecheck + 手动）

**Files:**
- Create: `src/settings/update/UpdateSettings.vue`
- Modify: `src/settings/SettingsApp.vue:42-44,54-57,71-76`

**Interfaces:**
- Consumes: 命令 `pet_update_check` / `pet_update_download` / `pet_update_apply`；事件 `update://progress`。

- [ ] **Step 1: 写面板组件**

新建 `src/settings/update/UpdateSettings.vue`：

```vue
<template>
  <div class="update-settings">
    <h2 class="update-settings__title">关于 / 更新</h2>

    <!-- 当前版本 + 检查按钮 -->
    <div class="update-settings__row">
      <span>当前版本：v{{ current || "…" }}</span>
      <el-button
        type="primary"
        :loading="checking"
        :disabled="downloading"
        @click="onCheck"
      >
        检查更新
      </el-button>
    </div>

    <!-- 状态提示 -->
    <el-alert
      v-if="message"
      :title="message"
      :type="messageType"
      :closable="false"
      show-icon
    />

    <!-- 有新版本：说明 + 下载/安装 -->
    <div v-if="latest && hasUpdate" class="update-settings__new">
      <p>发现新版本 v{{ latest }}</p>
      <pre v-if="notes" class="update-settings__notes">{{ notes }}</pre>

      <el-progress
        v-if="downloading || progress > 0"
        :percentage="progress"
        :status="progress === 100 ? 'success' : undefined"
      />

      <el-button
        v-if="!downloadedPath"
        type="success"
        :loading="downloading"
        @click="onDownload"
      >
        下载新版本
      </el-button>
      <el-button v-else type="warning" @click="onApply">
        立即安装并重启
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ElMessage } from "element-plus";

/** 后端 pet_update_check 的返回结构。 */
interface CheckResult {
  hasUpdate: boolean;
  current: string;
  latest: string;
  notes: string;
}

const current = ref("");
const latest = ref("");
const notes = ref("");
const hasUpdate = ref(false);
const checking = ref(false);
const downloading = ref(false);
const progress = ref(0);
const downloadedPath = ref("");
const message = ref("");
const messageType = ref<"success" | "info" | "warning" | "error">("info");

/** 手动检查更新。 */
async function onCheck() {
  checking.value = true;
  message.value = "";
  try {
    const r = await invoke<CheckResult>("pet_update_check");
    current.value = r.current;
    latest.value = r.latest;
    notes.value = r.notes;
    hasUpdate.value = r.hasUpdate;
    if (!r.hasUpdate) {
      message.value = "已是最新版本";
      messageType.value = "success";
    }
  } catch (e) {
    message.value = `检查失败：${e}`;
    messageType.value = "error";
  } finally {
    checking.value = false;
  }
}

/** 下载新版本（进度由事件驱动）。 */
async function onDownload() {
  downloading.value = true;
  progress.value = 0;
  message.value = "";
  try {
    downloadedPath.value = await invoke<string>("pet_update_download");
    progress.value = 100;
    message.value = "下载完成，可安装重启";
    messageType.value = "success";
  } catch (e) {
    message.value = `下载失败：${e}`;
    messageType.value = "error";
  } finally {
    downloading.value = false;
  }
}

/** 安装并重启。 */
async function onApply() {
  try {
    await invoke("pet_update_apply");
  } catch (e) {
    ElMessage.error(`安装失败：${e}`);
  }
}

/** 监听下载进度事件。 */
let unlisten: UnlistenFn | undefined;
onMounted(async () => {
  current.value = ""; // 进入面板先查一次拿当前版本
  await onCheck();
  unlisten = await listen<{ downloaded: number; total: number }>(
    "update://progress",
    (e) => {
      const { downloaded, total } = e.payload;
      if (total > 0) progress.value = Math.floor((downloaded / total) * 100);
    },
  );
});
onUnmounted(() => unlisten?.());
</script>

<style scoped>
.update-settings {
  padding: 20px;
}
.update-settings__title {
  margin: 0 0 16px;
  font-size: 16px;
}
.update-settings__row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.update-settings__new {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.update-settings__notes {
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin: 0;
}
</style>
```

- [ ] **Step 2: 挂进 SettingsApp**

`src/settings/SettingsApp.vue`：
1. 模板的 `<KeepAlive>` 内、`ShortcutSettings` 分支前加：
```html
        <UpdateSettings v-else-if="activeKey === 'update'" />
```
2. import 区（`ShortcutSettings` import 旁）加：
```ts
import UpdateSettings from "./update/UpdateSettings.vue";
```
3. `navItems` 数组末尾加：
```ts
  { key: "update", label: "关于 / 更新", icon: "🔄" },
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: 手动验证**

`pnpm app:dev` → 托盘打开设置 → 点「关于 / 更新」→ 看到当前版本、点「检查更新」有响应（无源时显示「检查失败：[gitee]…」属正常）。

- [ ] **Step 5: 提交**

```bash
git add src/settings/update/UpdateSettings.vue src/settings/SettingsApp.vue
git commit -m "feat: 设置窗口新增「关于/更新」面板"
```

---

## Task 8: 主窗口启动静默检查 + 轻提示（前端）

**Files:**
- Modify: `src/components/Pet/Pet.vue`

**Interfaces:**
- Consumes: 命令 `pet_update_check`、`pet_open_settings`（已存在，接受 `{ tab }`）。

- [ ] **Step 1: 在 Pet.vue 加静默检查**

在 `src/components/Pet/Pet.vue` 的 `<script setup>` 中，找到现有 `onMounted`（或新增一个），加入静默检查逻辑。新增响应式状态与函数：

```ts
import { invoke } from "@tauri-apps/api/core"; // 若已 import 则复用，勿重复

/** 是否检测到新版本（控制轻提示气泡显示）。 */
const updateAvailable = ref(false);

/** 启动后台静默检查更新；失败完全忽略（不打扰用户）。 */
async function silentCheckUpdate() {
  try {
    const r = await invoke<{ hasUpdate: boolean }>("pet_update_check");
    updateAvailable.value = r.hasUpdate;
  } catch {
    // 静默：网络不可达 / 无源时不提示
  }
}

/** 点击提示气泡：打开设置窗口的「关于/更新」页。 */
function openUpdatePage() {
  updateAvailable.value = false;
  invoke("pet_open_settings", { tab: "update" });
}
```

在已有的 `onMounted(async () => { ... })` 内末尾追加一行：

```ts
  silentCheckUpdate();
```

> 若 `Pet.vue` 当前没有 `ref` import，请在顶部 `import { ref, onMounted } from "vue";` 补上（按现有 import 实际情况合并，勿重复声明）。

- [ ] **Step 2: 加轻提示气泡到模板**

在 `Pet.vue` `<template>` 根容器内合适位置（猫精灵之上、不挡交互处）加一个小气泡，仅在 `updateAvailable` 为真时显示：

```html
    <!-- 发现新版本：右上角轻提示，点开跳设置「关于/更新」 -->
    <div
      v-if="updateAvailable"
      class="pet-update-badge"
      title="发现新版本，点击查看"
      @click="openUpdatePage"
    >
      🔔 新版本
    </div>
```

在 `<style scoped>` 加：

```css
/* 新版本轻提示气泡：右上角小药丸，不打断使用 */
.pet-update-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 50;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #fff;
  background: var(--el-color-primary, #409eff);
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
```

> 注意：主窗口透明且可能开启了点击穿透。气泡需要可点击，确认它落在猫的内容框内（非穿透区）；若主窗口默认整窗穿透，则气泡点击也会被穿透——此时改为依赖设置面板内提示即可，气泡作为锦上添花。实现时按主窗口实际穿透策略确认气泡可点击；不可点击则保留显示、引导用户从托盘进设置。

- [ ] **Step 2.5: 确认穿透下气泡可点击**

查看 `Pet.vue` 现有穿透逻辑（`setIgnoreCursorEvents`）。若默认开启整窗穿透导致气泡不可点，采用兜底：气泡只显示不可点，文案改为「🔔 新版本（托盘→设置查看）」。记录实际采用方案。

- [ ] **Step 3: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: 手动验证**

`pnpm app:dev`，启动后若有可达更新源且版本更高，右上角出现气泡，点击打开设置「关于/更新」页。无源时无气泡（静默），符合预期。

- [ ] **Step 5: 提交**

```bash
git add src/components/Pet/Pet.vue
git commit -m "feat: 主窗口启动静默检查更新并轻提示"
```

---

## Task 9: 打包脚本拆分产物 + 生成 version.json（脚本）

**Files:**
- Modify: `scripts/package.mjs`

**Interfaces:**
- Produces: `dist-package/` 下 `duoduo.exe`、`duoduo-resources.zip`、`duoduo-<版本>-full.zip`、`version.json`。

- [ ] **Step 1: 改写 package.mjs**

把 `scripts/package.mjs` 改为产出四产物 + version.json。在现有「压成 zip」段之后、最终日志之前，替换/扩展为如下逻辑（保留顶部 import 与前置检查、stage 收集不变）：

```js
import { createHash } from "node:crypto";
import { writeFileSync, statSync, readdirSync } from "node:fs";

// —— 在 stageDir 收集好 duoduo.exe + resources/ 之后 ——

// 1) 整合 zip（新手一站式）：dist-package/duoduo-<版本>-full.zip
const fullZip = join(outRoot, `duoduo-${version}-full.zip`);
rmSync(fullZip, { force: true });
execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Compress-Archive -Path '${stageDir}' -DestinationPath '${fullZip}' -Force`,
], { stdio: "inherit" });

// 2) 裸 exe（热更新目标）：dist-package/duoduo.exe
const bareExe = join(outRoot, "duoduo.exe");
rmSync(bareExe, { force: true });
cpSync(join(stageDir, "duoduo.exe"), bareExe);

// 3) 资源 zip：dist-package/duoduo-resources.zip
const resZip = join(outRoot, "duoduo-resources.zip");
rmSync(resZip, { force: true });
execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Compress-Archive -Path '${join(stageDir, "resources")}' -DestinationPath '${resZip}' -Force`,
], { stdio: "inherit" });

// 4) version.json（含裸 exe 的 sha256 + 大小）。notes 取 CHANGELOG 顶部版本段（缺失则空）。
const exeBytes = readFileSync(bareExe);
const sha256 = createHash("sha256").update(exeBytes).digest("hex");
const size = statSync(bareExe).size;
let notes = "";
try {
  const cl = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
  // 取第一个 "## [" 段到下一个 "## [" 之间的内容作为更新说明。
  const segs = cl.split(/^## \[/m);
  if (segs[1]) notes = "## [" + segs[1].split(/^## \[/m)[0].trim();
} catch { /* 无 CHANGELOG 时留空 */ }

const manifest = {
  version,
  notes,
  pubDate: new Date().toISOString().slice(0, 10),
  exe: { name: "duoduo.exe", size, sha256 },
};
const manifestPath = join(outRoot, "version.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n✅ 产物：`);
console.log(`   ${fullZip}`);
console.log(`   ${bareExe}`);
console.log(`   ${resZip}`);
console.log(`   ${manifestPath}（sha256=${sha256.slice(0, 12)}…）`);
```

> 把文件顶部已有的 `import` 合并：现有已 import `existsSync, mkdirSync, rmSync, cpSync, readFileSync`；新增 `writeFileSync, statSync, readdirSync` 与 `createHash`。`readdirSync` 实际未用可不加——仅加真正用到的 `writeFileSync, statSync` 与 `crypto` 的 `createHash`。删掉原本只产出单个 `duoduo-<版本>-windows.zip` 的那段（被 full zip 取代），或保留并改名，二选一，避免重复产物。

- [ ] **Step 2: 运行验证**

前置：需已有 release exe。若没有，先 `cd src-tauri && cargo build --release` 生成 `target/release/duoduo.exe`。
Run: `node scripts/package.mjs`
Expected: `dist-package/` 下出现 `duoduo.exe`、`duoduo-resources.zip`、`duoduo-<版本>-full.zip`、`version.json`；打开 version.json 确认含 `version/notes/pubDate/exe.{name,size,sha256}`，sha256 为 64 位 hex。

- [ ] **Step 3: 校验 sha256 一致**

Run: `cd dist-package && powershell -NoProfile -Command "(Get-FileHash duoduo.exe -Algorithm SHA256).Hash.ToLower()"`
Expected: 输出与 version.json 里的 `exe.sha256` 一致。

- [ ] **Step 4: 提交**

```bash
git add scripts/package.mjs
git commit -m "feat: 打包拆分裸 exe/资源/整合 zip 并生成 version.json"
```

---

## Task 10: CI 上传四产物（配置）

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 9 产出的 `dist-package/` 文件。

- [ ] **Step 1: 改上传清单**

`.github/workflows/release.yml` 的「发布到 GitHub Releases」步骤，把 `files:` 改为：

```yaml
        with:
          files: |
            dist-package/duoduo.exe
            dist-package/version.json
            dist-package/duoduo-resources.zip
            dist-package/duoduo-*-full.zip
          body_path: RELEASE_NOTES.md
```

> 说明：`version.json` 上传为 Release 资产后，GitHub 的 `releases/latest/download/version.json` 即可稳定取到（对应共享契约里 GitHub 的 manifest 地址）。

- [ ] **Step 2: 校验 YAML**

Run: `pnpm exec js-yaml .github/workflows/release.yml > /dev/null 2>&1 || node -e "require('fs').readFileSync('.github/workflows/release.yml','utf8')"`
Expected: 无解析报错（如无 js-yaml，至少肉眼核对缩进：`files:` 多行用 `|` 块、每行两空格缩进对齐）。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/release.yml
git commit -m "ci: Release 上传裸 exe/version.json/资源/整合 zip"
```

---

## Task 11: 镜像发布脚本 publish-mirrors（脚本，半自动）

**Files:**
- Create: `scripts/publish-mirrors.mjs`
- Modify: `package.json:scripts`

**Interfaces:**
- Consumes: `dist-package/duoduo.exe`、`dist-package/version.json`；环境变量 `GITEE_TOKEN`、`DUODUO_SERVER_SCP`（如 `user@host:/var/www/duoduo`）。
- Produces: 把 exe + version.json 推到 Gitee Release 和服务器；把 version.json 提交到 Gitee 仓库 `master`（供 raw 链接）。

- [ ] **Step 1: 写脚本**

新建 `scripts/publish-mirrors.mjs`：

```js
// 半自动镜像发布：把 dist-package/ 的 duoduo.exe + version.json 同步到
//   1) Gitee Release（需 GITEE_TOKEN）；
//   2) Gitee 仓库 master 的 version.json（供 raw 链接，更新器查版本用）；
//   3) 自建服务器（scp，需 DUODUO_SERVER_SCP 指向目标目录）。
//
// 用法：先 pnpm app:build（产出 dist-package/），再 GITEE_TOKEN=xxx \
//   DUODUO_SERVER_SCP=user@host:/var/www/duoduo pnpm publish:mirrors
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist-package");
const exe = join(dist, "duoduo.exe");
const manifest = join(dist, "version.json");

for (const f of [exe, manifest]) {
  if (!existsSync(f)) {
    console.error(`✗ 缺产物：${f}\n  先运行 pnpm app:build。`);
    process.exit(1);
  }
}
const { version } = JSON.parse(readFileSync(manifest, "utf-8"));
const tag = `v${version}`;
const OWNER = "wuguanwen28";
const REPO = "duoduo";

// —— 1) Gitee Release：创建 release（若不存在）并上传 exe + version.json ——
const giteeToken = process.env.GITEE_TOKEN;
if (giteeToken) {
  console.log("→ 同步 Gitee Release...");
  // 创建 release（已存在会返回错误，忽略即可）。
  await fetch(`https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: giteeToken,
      tag_name: tag,
      name: tag,
      body: `duoduo ${tag}`,
      target_commitish: "master",
    }),
  }).then((r) => r.text()).then((t) => console.log("  release:", t.slice(0, 80)));
  // 上传资产用 multipart；Gitee v5 附件接口按 release id，需先查 id。
  // 简化：用 form-data 走 attach_files 接口（按 release tag 查 id）。
  const rel = await fetch(
    `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/tags/${tag}?access_token=${giteeToken}`,
  ).then((r) => r.json());
  for (const file of [exe, manifest]) {
    const fd = new FormData();
    fd.append("access_token", giteeToken);
    fd.append("file", new Blob([readFileSync(file)]), file.split(/[\\/]/).pop());
    const up = await fetch(
      `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/${rel.id}/attach_files`,
      { method: "POST", body: fd },
    );
    console.log(`  上传 ${file.split(/[\\/]/).pop()}: HTTP ${up.status}`);
  }
} else {
  console.warn("⚠ 未设 GITEE_TOKEN，跳过 Gitee Release。");
}

// —— 2) Gitee 仓库 master 的 version.json（raw 链接源）——
console.log("→ 更新仓库内 version.json（供 raw 链接）...");
copyFileSync(manifest, join(root, "version.json"));
const git = (args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });
try {
  git(["add", "version.json"]);
  git(["commit", "-m", `chore: 更新 version.json 至 ${tag}\n\nchangelog: ignore`]);
  git(["push", "origin", "master"]); // origin = gitee
} catch {
  console.warn("⚠ version.json 无改动或推送失败，按需手动处理。");
}

// —— 3) 服务器 scp ——
const scpTarget = process.env.DUODUO_SERVER_SCP;
if (scpTarget) {
  console.log(`→ scp 到服务器 ${scpTarget} ...`);
  // 约定服务器目录结构：<target>/version.json 与 <target>/v<ver>/duoduo.exe
  execFileSync("ssh", [scpTarget.split(":")[0], `mkdir -p ${scpTarget.split(":")[1]}/v${version}`], { stdio: "inherit" });
  execFileSync("scp", [manifest, `${scpTarget}/version.json`], { stdio: "inherit" });
  execFileSync("scp", [exe, `${scpTarget}/v${version}/duoduo.exe`], { stdio: "inherit" });
} else {
  console.warn("⚠ 未设 DUODUO_SERVER_SCP，跳过服务器同步。");
}

console.log("\n✅ 镜像发布完成（已跳过的源见上方警告）。");
```

`package.json` 的 `scripts` 加一行：

```json
    "publish:mirrors": "node scripts/publish-mirrors.mjs",
```

> 说明：`version.json` 会被提交进 Gitee 仓库根，供 `raw/master/version.json` 取——这与 spec §5 候选方案 (a) 一致。提交带 `changelog: ignore` 不污染日志。把根目录 `version.json` 加进 `.gitignore`？不——它需要进库，**不要**忽略它。

- [ ] **Step 2: 语法/干跑验证**

Run: `node --check scripts/publish-mirrors.mjs`
Expected: 无语法错误。
Run（不带任何 env，验证跳过分支不报错；需先有 dist-package 产物，否则会在前置检查退出——可临时造空文件测试跳过逻辑）：`node scripts/publish-mirrors.mjs` → 预期打印三处「⚠ 未设…跳过」而非崩溃（前提：dist-package 下有 duoduo.exe 与 version.json）。

- [ ] **Step 3: 提交**

```bash
git add scripts/publish-mirrors.mjs package.json
git commit -m "feat: 新增 publish:mirrors 同步 Gitee/服务器"
```

---

## Task 12: 收尾——文档与默认源占位提示

**Files:**
- Modify: `CLAUDE.md`（在合适处补一段「热更新」说明）
- Modify: `src-tauri/src/updater.rs`（`SERVER_BASE` 上方注释强调替换）

**Interfaces:** 无新接口；纯文档/提示。

- [ ] **Step 1: 在 updater.rs 强化占位提示**

确认 `SERVER_BASE` 常量上方注释清晰标注「占位，发布前替换为真实服务器域名」，并在文件顶部模块注释补一句「下载源地址见 manifest_urls/exe_urls，服务器地址为 SERVER_BASE 占位」。

- [ ] **Step 2: CLAUDE.md 补充**

在 `CLAUDE.md` 的「Architecture」或新增「热更新」小节，补：更新源三级 fallback、只更 exe、自替换机制、发布流程（CI + `pnpm publish:mirrors`）、待填参数（SERVER_BASE / GITEE_TOKEN / DUODUO_SERVER_SCP）。

- [ ] **Step 3: 类型/编译总检**

Run: `cd src-tauri && cargo check && cd .. && pnpm exec vue-tsc --noEmit`
Expected: 均通过。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md src-tauri/src/updater.rs
git commit -m "docs: 补充热更新机制与待填参数说明

changelog: ignore"
```

---

## Self-Review（计划自审）

**Spec 覆盖：**
- §1 产物拆分 → Task 9 ✅
- §2 version.json 格式 → Task 9（生成）+ Task 1（解析类型）✅
- §3 三源 fallback → Task 2（URL）+ Task 4（manifest fallback）+ Task 5（exe fallback）✅
- §4 更新器流程 → Task 4/5/6（检查→下载→应用）✅
- §5 Gitee raw 方案 (a) → Task 11 Step 1（提交 version.json 到 master）✅
- §6 前端交互 → Task 7（面板）+ Task 8（启动静默+轻提示）✅
- §7 自替换 → Task 6 ✅
- §8 发布侧 → Task 9/10/11 ✅
- §9 sha256 → Task 3（算）+ Task 5（验）✅
- §13 待填参数 → Task 12（提示）✅

**Placeholder 扫描：** `SERVER_BASE`、`GITEE_TOKEN`、`DUODUO_SERVER_SCP` 均为**有意的待填参数**（spec §13 已声明），非计划占位；每处都有具体默认值/获取方式与替换说明。无 TODO/“稍后实现”类空洞步骤。

**类型一致性：** Rust 命令名 `pet_update_check/download/apply` 全程一致；返回结构 `CheckResult`（camelCase 序列化）与前端 TS `interface CheckResult { hasUpdate,current,latest,notes }` 对齐；进度事件 `update://progress` payload `{downloaded,total}` 两端一致；version.json 字段 `version/notes/pubDate/exe.{name,size,sha256}` 在 Task 9 生成与 Task 1 `VersionManifest` 解析对齐。

**已知风险（实现时关注）：**
- Task 8 主窗口穿透可能使气泡不可点 → 已给兜底方案（依赖设置面板提示）。
- Task 6 自替换只能在发布构建验证 → 已标注 dev 禁用与手动验证步骤。
- Task 11 Gitee 附件上传接口（attach_files / release id）以 Gitee v5 文档为准，实现时按实际响应调整字段。
