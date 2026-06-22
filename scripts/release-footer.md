<!-- 本段由 .github/workflows/release.yml 追加到 GitHub Release 说明末尾；__VERSION__ 在 CI 中被替换为版本号（不含 v）。 -->

---

## 📦 下载说明

| 文件 | 适合谁 | 内容 |
|---|---|---|
| **`duoduo.exe`** | 🔄 已安装的老用户 | 仅主程序，覆盖原 `duoduo.exe` 即可（也是软件内「热更新」下载的目标） |
| **`duoduo-resources.zip`** | 🎨 默认素材包（`resources/`），解压后覆盖 exe 同级的 `resources/` |
| **`duoduo-__VERSION__-full.zip`** | 🆕 新用户（推荐） | 整合包：主程序 + 全套素材，下载解压即用 |

> `version.json` 是热更新元数据（版本号、sha256、大小），软件会自动读取，无需手动下载。
