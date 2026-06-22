# 多多（duoduo）热更新功能 — 设计方案

- 日期：2026-06-22
- 状态：设计已确认，待写实现计划
- 适用：duoduo 绿色版桌面宠物（Tauri 2，Windows，无安装器）

## 1. 背景与约束

duoduo 以**绿色版裸 exe** 分发（`bundle.active=false`，无 NSIS/MSI 安装器），帧资源
完全外置于 exe 同级的 `resources/`、可被用户替换。当前打包脚本 `scripts/package.mjs`
产出**一个合并 zip**（exe + resources），CI（`release.yml`）上传该 zip 到 GitHub Release。

这些既有事实带来三条硬约束：

1. **官方 `tauri-plugin-updater` 基本不适用** —— 它为安装器/应用包设计，更新时要跑
   安装器。裸 exe 绿色版需**自实现更新器**。
2. **运行中的 exe 不能被自身覆盖**（Windows 文件锁），自替换需用「改名腾位」时序。
3. **resources/ 可能被用户改过**，更新不能覆盖它。

## 2. 已确认决策

| 维度 | 决策 |
|---|---|
| 更新范围 | **只更 exe**，`resources/` 永不被热更新触碰 |
| 下载源 | **Gitee → GitHub → 自建服务器** 依次 fallback；服务器排末位以省带宽 |
| 触发 | **启动静默检查**（有新版才轻提示）**+ 设置窗口手动「检查更新」按钮** |
| 发布 | GitHub 走 CI 自动；**Gitee + 服务器**用半自动脚本 `pnpm publish:mirrors` |
| 完整性 | 下载 exe 做 **sha256 校验**；代码签名/验签列为将来增强 |
| 兼容产物 | 保留一个 full zip 给新手一站式下载 |

## 3. 分发产物拆分

`package.mjs` 由「一个合并 zip」改为产出：

| 产物 | 内容 | 用途 |
|---|---|---|
| `duoduo.exe` | 裸 exe（数 MB） | **热更新下载目标**；新用户亦可单独下 |
| `duoduo-resources.zip` | 默认 `resources/` | 首次安装 / 恢复默认资源 |
| `version.json` | 版本元数据（见 §4） | 更新器先拉此文件比对版本 |
| `duoduo-<版本>-full.zip` | exe + resources（合并） | 新手一站式下载（保留现有体验） |

## 4. version.json 格式

CI 构建时生成，含 exe 的 sha256，作为 **Release 资产**上传（不提交进 git 仓库，
以规避「sha256 需先有产物、产物又在 CI 才生成」的鸡生蛋问题）：

```jsonc
{
  "version": "0.2.0",        // 最新版本号（语义化）
  "notes": "修复投喂闪现…",   // 更新说明，可取自 CHANGELOG 当前段
  "pubDate": "2026-06-22",
  "exe": {
    "name": "duoduo.exe",
    "size": 8123456,
    "sha256": "abc123…"      // 完整性校验值
  }
}
```

**下载地址不写进 version.json**，而由更新器各源用 URL 模板按版本号拼装，便于将来换源/
改路径而不必动已发布的 json。

## 5. 三源 fallback

更新器内置三个源配置，每源含 `version.json` 地址与 `exe` 地址模板，按序尝试：

version.json 的获取地址必须**与版本号无关**（查最新版本时还不知道版本号），exe 的
下载地址才用版本号拼。两者分开：

| 顺序 | 源 | version.json URL（稳定，无版本号） | exe URL 模板（带版本号） |
|---|---|---|---|
| 1 | Gitee | 见下注（Gitee 无 `latest` 下载别名，需特殊处理） | `gitee.com/wuguanwen28/duoduo/releases/download/v{ver}/duoduo.exe` |
| 2 | GitHub | `github.com/wuguanwen28/duoduo/releases/latest/download/version.json` | `github.com/wuguanwen28/duoduo/releases/download/v{ver}/duoduo.exe` |
| 3 | 服务器 | `https://<占位:你的服务器>/duoduo/version.json`（固定路径，始终最新） | `https://<占位>/duoduo/v{ver}/duoduo.exe` |

- **查版本**：依次 GET version.json，第一个成功者即用（文件极小，几乎不耗流量）。
- **下 exe**：拿到版本号后，同样按 Gitee→GitHub→服务器顺序下载，第一个成功且
  **sha256 校验通过**者即用。
- 服务器置末位 → 绝大多数流量由 Gitee/GitHub 承担，保护服务器带宽。
- **关于 Gitee 的 version.json 地址（待实现确认）**：GitHub 有 `releases/latest/download/`
  稳定别名、服务器是固定路径，唯独 Gitee 没有「latest 下载」别名。候选方案（实现时择一）：
  (a) `publish-mirrors.mjs` 额外把 version.json 提交到 Gitee 仓库固定路径，用 raw 链接
  `gitee.com/wuguanwen28/duoduo/raw/master/version.json` 取（无版本依赖）；
  (b) 走 Gitee 开放 API 查最新 release 再取其资产。倾向 (a)，更简单稳定。
  无论哪种，更新器只认一个稳定 URL，不感知差异。

## 6. 更新器执行流程

```
启动静默检查 / 点「检查更新」
        │
        ▼
 拉 version.json（三源 fallback）
        │
   语义化比对版本号（latest > current 才继续）
        │  无新版 → 静默结束 / 提示「已是最新」
        ▼
 提示「发现新版 {ver}，{notes}，是否更新？」
        │  用户确认
        ▼
 下载 duoduo.exe → 临时文件（三源 fallback + 进度事件）
        │
   sha256 校验 ──失败──► 删临时文件、报错、可重试
        │ 通过
        ▼
 Windows 自替换（§7）→ 重启新版
```

## 7. Windows 自替换机制

运行中的 exe 不能被直接覆盖，用「改名腾位」法，**纯 Rust 实现，无需外部 bat/helper**：

```
下载新 exe → duoduo.exe.new   （sha256 校验通过后）
关键三步：
  1. 当前 duoduo.exe   → 重命名为 duoduo.exe.old   （运行中可改名）
  2. duoduo.exe.new    → 重命名为 duoduo.exe
  3. 用新 exe 启动新进程，当前进程 exit(0)
新进程下次启动时：检测并删除残留的 duoduo.exe.old
```

- 全程仅在 exe 所在目录操作，**绝不碰 resources/**。
- 失败可回滚（`.old` 仍在）。
- 开发模式（`debug_assertions`）下**禁用自替换**，避免误删 `target/` 下的 exe。

## 8. 前端交互

复用现有设置窗口（`SettingsApp.vue` 已有左侧导航）：

- **新增导航项「关于 / 更新」**：显示当前版本号、「检查更新」按钮、检查/下载状态与
  进度条、更新说明。
- **启动静默检查**：主窗口 `App.vue` 挂载后台调一次 `pet_update_check`；有新版则在
  **主窗口区域轻提示**（小气泡/角标，不打断使用），用户点了再进确认流程；无新版完全静默。
- 下载进度、校验、重启全程有明确中文状态文案。

## 9. 后端命令（Rust）

延续 `lib.rs` 已按职责拆分的模块风格，新增 `src-tauri/src/updater.rs`：

| 命令 / 钩子 | 职责 |
|---|---|
| `pet_update_check` | 三源拉 version.json，返回 `{ hasUpdate, latest, notes, current }` |
| `pet_update_download` | 三源下 exe 到临时文件 + sha256 校验，通过**事件**上报进度 |
| `pet_update_apply` | 执行 §7 自替换 + 重启 |
| 启动清理（非命令） | `run()` 启动时删除残留 `duoduo.exe.old` |

网络请求放 Rust 侧（`reqwest` 或 tauri http 能力），便于流式下载 + 进度 + 校验，
并绕开前端 CORS。自定义命令注册进 `invoke_handler` 即可，无需改 capabilities。

## 10. 发布侧改造

- **`scripts/package.mjs`**：产出 §3 的拆分产物 + `version.json`（含 sha256）。
- **`.github/workflows/release.yml`**：上传 `duoduo.exe` + `duoduo-resources.zip` +
  `version.json` + full zip 到 GitHub Release（替换现在的单 zip 上传）。
- **新增 `scripts/publish-mirrors.mjs`**（`pnpm publish:mirrors`）：把 `duoduo.exe` +
  `version.json` 推到 **Gitee Release**（Gitee token）和**你的服务器**（sftp）。
  发版时 GitHub 由 CI 自动完成，本地再跑此脚本同步另外两源。

## 11. 安全 / 完整性

- **sha256 校验**下载的 exe（防损坏/截断），不通过则拒绝替换。
- **暂不做代码签名/验签**（无证书）。将来可加：version.json 内附签名 + app 内置公钥
  验签，防中间人篡改。

## 12. 不做 / 将来

- ❌ 不更新 resources（已决策）
- ❌ 不引入安装器（保持绿色版）
- ❌ 不做增量/差分更新（exe 小，整包下够用）
- 🔜 代码签名 / 验签（可选增强）
- 🔜 自动定时检查（现仅启动时查一次）

## 13. 待落地参数（实现时填）

- 服务器域名 / version.json 与 exe 的存放路径
- Gitee 个人访问令牌（用于 `publish-mirrors.mjs` 上传 Release 资产）
- 服务器 sftp 凭据来源（复用 `.vscode/sftp.json` 思路或单独配置，注意不入库）
