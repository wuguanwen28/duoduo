//! 配置持久化：全局 `setting.json` + 每猫 `cats/<id>.json` + 头像 `avatars/<id>.png`。
//!
//! 数据分层：
//! - 全局文件存**身份档案**（每猫 name/birthday/gender/tags/description）+ activeCatId
//!   + resourceRoot，供设置页卡片列表与选猫弹窗一次读齐，无需打开每个猫文件。
//! - 每只猫的**行为配置**（display/menu/说话/触发器/windowPos）独立文件，写一只猫
//!   不影响其他猫（无竞态、不丢猫）。
//! - 头像单独存文件 `avatars/<id>.png`，**文件是否存在即唯一真源**（不存 hasAvatar 标记）。
//! - 路径在 home/.duoduo/，与 bundle identifier 无关，改 id 不丢配置。

use std::collections::HashMap;
use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

// ── 路径定位 ───────────────────────────────────────────────────

/// 配置根目录：`home/.duoduo/`。供 icon.rs 等复用（自定义应用图标也存这里，脱离资源根）。
pub(crate) fn duoduo_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().home_dir().ok().map(|h| h.join(".duoduo"))
}

/// 全局配置路径：`setting.json`。
fn global_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    duoduo_dir(app).map(|d| d.join("setting.json"))
}

/// 单猫配置路径：`cats/<catId>.json`。
fn cat_path(app: &tauri::AppHandle, cat_id: &str) -> Option<PathBuf> {
    duoduo_dir(app).map(|d| d.join("cats").join(format!("{cat_id}.json")))
}

/// 头像路径：`avatars/<catId>.png`。
fn avatar_path(app: &tauri::AppHandle, cat_id: &str) -> Option<PathBuf> {
    duoduo_dir(app).map(|d| d.join("avatars").join(format!("{cat_id}.png")))
}

// ── 全局结构 ───────────────────────────────────────────────────

/// 全局配置：版本 + 激活猫 + 身份档案表。（资源根已下放到每猫 cats/<id>.json）
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSettings {
    /// 结构版本号。
    pub version: u32,
    /// 当前激活猫 id（桌面焦点/默认显示）。
    pub active_cat_id: String,
    /// 猫 id → 身份档案（name/birthday/gender/tags/description），供卡片列表与选猫弹窗
    /// 一次读齐，无需打开每个猫文件。头像有无由 avatars/<id>.png 是否存在决定，不在此。
    pub cats: HashMap<String, CatMeta>,
    /// 更新气泡关闭计次；None 表示从未关闭过任何版本的提醒。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub update_dismiss: Option<UpdateDismissState>,
    /// 启动时自动上班（show 宠物窗）的猫 id 列表；用户在基础设置卡片勾选。
    /// 旧配置无此字段时反序列化为空 Vec，前端启动时回退为 ["default"]。
    #[serde(default)]
    pub auto_show_cats: Vec<String>,
}

/// 更新气泡的关闭计次：同一版本最多自动提醒 2 次，避免用户误关一次就再也看不到提示；
/// 检测到更新的版本号时，前端会存入新的 `version`，计次自然从 0 重新开始。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDismissState {
    pub version: String,
    pub count: u8,
}

/// 猫身份档案（存于全局 setting.json 的 cats）：名字 + 人设信息。
/// 行为配置（display/menu/说话/触发器）仍在 cats/<id>.json；头像在 avatars/<id>.png。
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatMeta {
    pub name: String,
    /// ISO 日期字符串（YYYY-MM-DD），空串表示未设置。
    #[serde(default)]
    pub birthday: String,
    /// "boy" / "girl" / "unknown"。
    #[serde(default)]
    pub gender: String,
    /// 用户自定义标签（可新增/删除）。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 用户自定义描述/简介。
    #[serde(default)]
    pub description: String,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        // 身份内容默认值（多多人设）的真源在前端 defaults.ts；此处仅给结构安全兜底：
        // 配置缺失时前端 bootstrapIfEmpty 会显式写出完整多多档案，故这里只保底一个名字。
        let mut cats = HashMap::new();
        cats.insert(
            "default".to_string(),
            CatMeta {
                name: "多多".to_string(),
                ..Default::default()
            },
        );
        Self {
            version: 1,
            active_cat_id: "default".to_string(),
            cats,
            update_dismiss: None,
            auto_show_cats: vec!["default".to_string()],
        }
    }
}

/// 读取全局配置；文件不存在/损坏返回 Default。
pub fn load_global(app: &tauri::AppHandle) -> GlobalSettings {
    let Some(path) = global_path(app) else {
        return GlobalSettings::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<GlobalSettings>(&text).unwrap_or_default(),
        Err(_) => GlobalSettings::default(),
    }
}

/// 写全局配置（原子写）。
pub fn save_global(app: &tauri::AppHandle, g: &GlobalSettings) -> Result<(), String> {
    let path = global_path(app).ok_or("无法定位 home 目录")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(g).map_err(|e| e.to_string())?;
    atomic_write(&path, &json)
}

// ── 单猫结构 ───────────────────────────────────────────────────

/// 单只猫的**行为配置**（cats/<id>.json）。身份信息（name/性别等）在全局 CatMeta，不在此。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatSettings {
    pub display: DisplaySettings,
    pub menu: Vec<MenuItemConfig>,
    pub speak_phrases: Vec<SpeakPhrase>,
    pub speak_phrases_default: Vec<SpeakPhrase>,
    pub trigger_bindings: TriggerBindings,
    /// 宠物窗上次位置（物理像素）；None=还没记录过，创建时算默认错开位置。
    #[serde(default)]
    pub window_pos: Option<WindowPos>,
    /// 该猫的素材目录（绝对路径）；None=未设置。默认猫 None 时后端回退内置 resources/，
    /// 其他猫 None 表示尚无素材（走缺资源引导）。**服务端拥有字段**：仅 pet_set_resource_root
    /// 能改，pet_save_cat 会从磁盘保留它，避免宠物窗整体覆盖 cat 文件时把它清空。
    #[serde(default)]
    pub resource_root: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettings {
    pub size: f64,
    pub opacity: f64,
    pub always_on_top: bool,
    pub passthrough: bool,
    /// 跟随光标开关（UI 在显示页，存储归 display）。
    #[serde(default = "default_true")]
    pub follow: bool,
    /// 头部校准偏移（占精灵直径比例）。
    #[serde(default)]
    pub head_offset: HeadOffset,
    /// 跟随静止回默认行为的超时（秒，1–30）。旧配置无此字段时兜底为 3。
    #[serde(default = "default_idle_return_sec")]
    pub idle_return_sec: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemConfig {
    pub id: String,
    pub action_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub phrases: Option<Vec<SpeakPhrase>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakPhrase {
    pub text: String,
    pub weight: f64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TriggerBindings {
    pub entries: Vec<TriggerBinding>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerBinding {
    pub id: String,
    pub kind: String,
    pub trigger: String,
    pub action_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_global: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub phrases: Option<Vec<SpeakPhrase>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadOffset {
    pub x: f64,
    pub y: f64,
}

/// 宠物窗位置（物理像素，屏幕绝对坐标）。
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WindowPos {
    pub x: i32,
    pub y: i32,
}

// ── 默认值 ─────────────────────────────────────────────────────
//
// 业务默认值（菜单文案 / 说话池 / 触发器绑定等「内容」）的唯一真源是前端
// src/pet-core/defaults.ts；首次启动由 bootstrapIfEmpty 显式写盘。
//
// Rust 端 Default 只承诺「结构合法、可安全读出」：集合型字段一律给空集合，
// 标量给渲染安全的最小值。配置损坏 / 缺失时 load_* 返回本 Default，前端各
// hydrate_* 对空集合会自动回退到 defaults.ts 的真源，用户下次改动即写回修复。
// 故这里不再手抄任何内容型默认值，也无需与 defaults.ts 逐值对齐。

impl Default for CatSettings {
    fn default() -> Self {
        Self {
            display: DisplaySettings::default(),
            // 集合型字段留空：前端 hydrate 对空集合会回退到 defaults.ts 真源，
            // 故 Rust 不再持有菜单 / 说话池 / 触发器等内容默认值。
            menu: Vec::new(),
            speak_phrases: Vec::new(),
            speak_phrases_default: Vec::new(),
            trigger_bindings: TriggerBindings::default(),
            window_pos: None,
            resource_root: None,
        }
    }
}

/// serde 字段默认：follow 缺省为开（旧配置 display 里无此字段时兜底）。
fn default_true() -> bool {
    true
}

/// serde 字段默认：静止回默认行为超时缺省 3 秒（旧配置无此字段时兜底）。
fn default_idle_return_sec() -> f64 {
    3.0
}

impl Default for DisplaySettings {
    fn default() -> Self {
        // 显示是渲染安全标量：不可清零（size=0 猫消失、opacity=0 全透明），
        // 故保留合法默认，并与前端 DISPLAY_DEFAULTS 逐值对齐（尤其 passthrough=false）。
        // follow / head_offset UI 在显示页、存储也归 display。
        Self {
            size: 0.5,
            opacity: 1.0,
            always_on_top: true,
            passthrough: false,
            follow: true,
            head_offset: HeadOffset::default(),
            idle_return_sec: 3.0,
        }
    }
}

impl Default for HeadOffset {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

// ── 单猫读写 ───────────────────────────────────────────────────

/// 读取单猫配置；文件不存在/损坏返回 Default。
pub fn load_cat(app: &tauri::AppHandle, cat_id: &str) -> CatSettings {
    let Some(path) = cat_path(app, cat_id) else {
        return CatSettings::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<CatSettings>(&text).unwrap_or_default(),
        Err(_) => CatSettings::default(),
    }
}

/// 写单猫配置（原子写）。
pub fn save_cat(app: &tauri::AppHandle, cat_id: &str, cat: &CatSettings) -> Result<(), String> {
    let path = cat_path(app, cat_id).ok_or("无法定位 home 目录")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cat).map_err(|e| e.to_string())?;
    atomic_write(&path, &json)
}

/// 删除一只猫：删 cat 文件 + 头像 + 全局元数据移除；若删的是激活猫则切到剩余第一只。
pub fn delete_cat(app: &tauri::AppHandle, cat_id: &str) -> Result<(), String> {
    if let Some(path) = cat_path(app, cat_id) {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    if let Some(path) = avatar_path(app, cat_id) {
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
    let mut g = load_global(app);
    g.cats.remove(cat_id);
    if g.active_cat_id == cat_id {
        g.active_cat_id = g
            .cats
            .keys()
            .next()
            .cloned()
            .unwrap_or_else(|| "default".to_string());
    }
    save_global(app, &g)
}

// ── 原子写 ─────────────────────────────────────────────────────

/// 原子写入：先写 `.json.tmp` 再 rename 覆盖目标，避免半写损坏。
fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入临时文件失败：{e}"))?;
    // Windows 上 rename 覆盖已存在文件会报错，先删目标再 rename。
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("替换配置文件失败：{e}"))
}

// ── 命令 ───────────────────────────────────────────────────────

/// setting.json 是否已在磁盘上存在（供前端判断是否首次启动、需 bootstrap 默认猫）。
#[tauri::command]
pub fn pet_settings_exists(app: tauri::AppHandle) -> bool {
    global_path(&app).map(|p| p.exists()).unwrap_or(false)
}

/// 加载全局配置。
#[tauri::command]
pub fn pet_load_global(app: tauri::AppHandle) -> GlobalSettings {
    load_global(&app)
}

/// 保存全局配置。
#[tauri::command]
pub fn pet_save_global(app: tauri::AppHandle, global: GlobalSettings) -> Result<(), String> {
    save_global(&app, &global)
}

/// 加载单猫配置。
#[tauri::command]
pub fn pet_load_cat(app: tauri::AppHandle, cat_id: String) -> CatSettings {
    load_cat(&app, &cat_id)
}

/// 保存单猫配置。
///
/// `resource_root` 是**服务端拥有字段**：前端 snapshot 不传它，此处从磁盘现值强制保留，
/// 使宠物窗/设置窗的整体覆盖写都动不了资源根——唯一改它的入口是 `pet_set_resource_root`。
/// 否则宠物窗一次 windowPos 保存就可能把设置窗刚设的资源根覆盖回 None，导致猫掉素材。
#[tauri::command]
pub fn pet_save_cat(
    app: tauri::AppHandle,
    cat_id: String,
    mut cat: CatSettings,
) -> Result<(), String> {
    cat.resource_root = load_cat(&app, &cat_id).resource_root;
    save_cat(&app, &cat_id, &cat)
}

/// 删除一只猫（cat 文件 + 头像 + 元数据）。
#[tauri::command]
pub fn pet_delete_cat(app: tauri::AppHandle, cat_id: String) -> Result<(), String> {
    delete_cat(&app, &cat_id)
}

/// 猫列表条目（身份档案 + 头像路径，供卡片列表/选猫弹窗一次拉齐，无需打开猫文件）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatEntry {
    pub id: String,
    pub name: String,
    pub birthday: String,
    pub gender: String,
    pub tags: Vec<String>,
    pub description: String,
    /// 头像绝对路径；空串表示无自定义头像。文件存在与否是头像有无的唯一真源。
    pub avatar_url: String,
}

/// 列出所有猫的身份档案 + 头像路径。
#[tauri::command]
pub fn pet_list_cats(app: tauri::AppHandle) -> Vec<CatEntry> {
    let g = load_global(&app);
    g.cats
        .iter()
        .map(|(id, meta)| CatEntry {
            id: id.clone(),
            name: meta.name.clone(),
            birthday: meta.birthday.clone(),
            gender: meta.gender.clone(),
            tags: meta.tags.clone(),
            description: meta.description.clone(),
            avatar_url: avatar_path(&app, id)
                .filter(|p| p.exists())
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        })
        .collect()
}

// ── 头像 ───────────────────────────────────────────────────────

/// 保存头像（base64 PNG → avatars/<catId>.png）。头像有无由文件存在与否决定，无需同步标记。
#[tauri::command]
pub fn pet_save_avatar(app: tauri::AppHandle, cat_id: String, data: String) -> Result<(), String> {
    let base64_str = data.split(',').nth(1).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_str)
        .map_err(|e| format!("base64 解码失败：{e}"))?;
    let path = avatar_path(&app, &cat_id).ok_or("无法定位 home 目录")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("保存头像失败：{e}"))
}

/// 返回头像绝对路径；不存在返回空串。
#[tauri::command]
pub fn pet_avatar_url(app: tauri::AppHandle, cat_id: String) -> String {
    let Some(path) = avatar_path(&app, &cat_id) else {
        return String::new();
    };
    if path.exists() {
        path.display().to_string()
    } else {
        String::new()
    }
}

/// 删除头像。头像有无由文件存在与否决定，删文件即可。
#[tauri::command]
pub fn pet_reset_avatar(app: tauri::AppHandle, cat_id: String) -> Result<(), String> {
    let Some(path) = avatar_path(&app, &cat_id) else {
        return Ok(());
    };
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 把某只猫的头像设为应用/托盘图标（复用 icon.rs）。
#[tauri::command]
pub fn pet_apply_avatar_as_icon(app: tauri::AppHandle, cat_id: String) -> Result<(), String> {
    let path = avatar_path(&app, &cat_id).ok_or("无法定位 home 目录")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("读取头像失败：{e}"))?;
    crate::icon::apply_icon_bytes(&app, &bytes)
}

/// 内置默认头像（与应用图标同一张 icon.png），供 bootstrap 给默认猫写入初始头像。
const DEFAULT_AVATAR_PNG: &[u8] = include_bytes!("../icons/icon.png");

/// 若某只猫尚无头像文件，写入内置默认头像（default.png）。已有头像则不覆盖。
/// 首次启动引导时调用，让默认猫「多多」开箱即带头像。
#[tauri::command]
pub fn pet_ensure_default_avatar(app: tauri::AppHandle, cat_id: String) -> Result<(), String> {
    let path = avatar_path(&app, &cat_id).ok_or("无法定位 home 目录")?;
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, DEFAULT_AVATAR_PNG).map_err(|e| format!("写入默认头像失败：{e}"))
}
