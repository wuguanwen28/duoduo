# 资源目录可选 + 持久化 + 树形下拉 设计

日期：2026-06-17
状态：已与老大确认，待写实现计划

## 背景与目标

当前 `resource_root()`（`src-tauri/src/lib.rs:359`）固定为：环境变量 `DUODUO_RESOURCES` → 开发模式项目根 `resources/` → 发布模式 exe 同级 `resources/`。没有「用户选定目录并记住」的能力，换猫只能改环境变量或把素材放到固定位置。

本次目标：

1. 默认仍找 exe 同级 `resources/`；若该处 **没有 `manifest.json`**，引导用户自己选择资源目录。
2. 用户选定目录后：以该目录为准（持久化到 **系统 AppData**，下次启动仍生效）；若选中目录没有 `manifest.json`，**自动创建空白模板**。
3. 资源设置页：
   - 顶栏增加「更换目录」入口（系统弹窗选目录）。
   - 「图片目录」（action.dir）/「帧目录」（follow.dir）输入框改为 **`el-tree-select`**，以资源根为根、**只列子目录**；右侧保留「选目录」按钮走系统弹窗选绝对路径。
4. `MissingResources.vue` 统一提示为新流程。

## 非目标（YAGNI）

- 不做多套素材切换列表 / 收藏夹。
- 树形下拉**只列目录**，不列帧文件。
- 不改动行为状态机、注视、缩放等既有逻辑。

## 架构改动

### 1. 后端 `src-tauri/src/lib.rs`

#### 1.1 `resource_root()` 优先级（新增第 2 档）

```
1) 环境变量 DUODUO_RESOURCES（保留，调试覆盖）
2) AppData 持久化的用户选定目录（新增）
3) 开发模式：项目根 resources/
4) 发布模式：exe 同级 resources/
```

实现要点：
- `resource_root()` 改为 `fn resource_root(app: &tauri::AppHandle) -> PathBuf`，因为读 AppData 需要 `app.path()`。
- 持久化文件：`app.path().app_config_dir()?/resource_path.txt`，内容为选定目录的绝对路径（纯文本，单行）。读到非空且目录存在则采用；否则继续往下走默认逻辑。
- 4 处调用点跟着传 `app`：
  - `pet_scan_resources`（`lib.rs:427`，已有 `app`）
  - `pet_read_manifest`（`lib.rs:518`，需新增 `app: tauri::AppHandle` 形参）
  - `pet_write_manifest`（`lib.rs:538`，需新增 `app` 形参）
  - `icon_path()`（`lib.rs:545`）→ 改为接收 `&AppHandle`，其调用方 `pet_save_icon` / `pet_reset_icon` 已有 `app`。

> 说明：`resource_root` 也可在启动时算一次缓存进 `PetState`，但因为用户在设置页可中途更换目录，缓存会失效，故采用每次按 `AppHandle` 实时计算（读一个小文本文件，开销可忽略），并由 `pet_set_resource_root` 直接覆写该文件。

#### 1.2 新增命令

- `pet_set_resource_root(app, path: String) -> Result<String, String>`
  1. 校验 `path` 非空且为已存在目录，否则 `Err`。
  2. 写入 AppData 的 `resource_path.txt`（`create_dir_all` 配置目录后写文件）。
  3. 若 `path/manifest.json` 不存在 → 写入空白模板（见下）。
  4. 返回新的资源根绝对路径。

  空白模板：
  ```json
  { "version": 1, "follow": { "dir": "follow", "clockwise": true, "startAngle": 0 }, "actions": {}, "behaviors": {} }
  ```

- `pet_get_resource_root(app) -> String`：返回 `resource_root(&app)` 的绝对路径字符串（设置页顶栏展示用）。

- `pet_list_dirs(app) -> Vec<DirNode>`：以资源根为根，**递归列出所有子目录**，返回树。
  ```rust
  #[derive(serde::Serialize)]
  struct DirNode { label: String, value: String, children: Vec<DirNode> }
  ```
  - `label` = 目录名（最后一段），`value` = 相对资源根的 POSIX 风格相对路径（如 `idle/blink`，统一用 `/` 以匹配 manifest 写法）。
  - 跳过隐藏目录（以 `.` 开头）；目录不可读时静默跳过。递归深度可设一个保护上限（如 8 层）以防异常深目录。

- 三个新命令注册进 `invoke_handler`（`lib.rs:660`）。自定义命令无需改 capabilities。

### 2. 前端设置页 `src/settings/ResourceSettings.vue`

- **空状态**：`pet_read_manifest` 返回 `exists=false`（没找到 `manifest.json`）时，**整页只显示空状态**（`el-empty` + 说明 + 主按钮「选择资源目录」），**不渲染** follow/行为库/动作库三块编辑卡片。用户选目录后会自动建模板，`reload()` 拿到 `exists=true` → 切回正常编辑器。用 `hasManifest = ref(false)`（来自 `reload` 的 `r.exists`）控制 `v-if`。
- **顶栏更换目录**：在 `root` tag 旁加 `el-button`「更换目录」。点击 → `open({directory:true})` 选目录 → `invoke("pet_set_resource_root", {path})` → 成功后 `reload()`（会重新读 manifest + 刷新目录树）。`ElMessage` 提示成功/失败。空状态里的「选择资源目录」按钮复用同一处理函数。
- **目录树数据**：`onMounted`/`reload` 时调 `pet_list_dirs` 存入 `dirTree = ref<DirNode[]>([])`。更换目录后重新拉取。
- **action.dir / follow.dir 改 `el-tree-select`**：
  - `:data="dirTree"`、`node-key="value"`、`:props="{ label:'label', children:'children' }"`、`check-strictly`、`filterable`、`:render-after-expand="false"`。
  - `v-model` 仍绑 `a.dir` / `follow.dir`（相对路径字符串）。
  - 右侧「选目录」按钮（系统弹窗）返回的可能是**绝对路径**。`el-tree-select` 默认只能显示树中存在的 `value`；为让绝对路径也能正常显示与选中，封装一个小组件 / 计算属性，把当前值若不在树中则作为一个**合成顶层节点** `{label: 该路径, value: 该路径, children: []}` 注入该下拉的数据源。
    - 实现方式：抽一个 `DirSelect.vue` 子组件，props 为 `modelValue` + `tree`，内部计算 `mergedTree`（树 + 必要时合成节点），emit `update:modelValue`；附带「选目录」append 按钮。action 与 follow 复用同一组件，避免重复逻辑。
- 现有 `pickDir`、`save`、`build`、`parseInto` 逻辑不变。

### 3. 缺资源卡片 `src/components/MissingResources/MissingResources.vue`

- 文案统一为：默认在 exe 同级 `resources/` 找素材；没找到就请「选择资源目录」。
- 主按钮由「查看设置教程」改为 **「选择资源目录」** → 仍调 `pet_open_settings({tab:"resources"})` 打开设置窗（在设置窗里完成选目录，符合「选目录在资源设置窗中进行」的约定）。
- 保留「重新加载」(`emit('retry')`)、「退出」(`pet_quit`)。
- 可选保留资源目录路径展示（`root` prop）。

### 4. 前端 store / App

`src/resources/store.ts` 与 `src/App.vue` 逻辑**无需改动**：
- 设置页保存 manifest 仍广播 `manifest-updated` → 主窗 `boot()` 重载。
- 更换目录后，设置页可额外广播一次 `manifest-updated`，让主窗也用新根重扫。
- 空白模板没有有效行为 → 主窗仍显示缺资源态，但用户此时已在设置页可继续配置动作。

## 数据流

```
启动 → loadResources → pet_scan_resources → resource_root(&app)
        ├─ AppData/resource_path.txt 有效 → 用它
        └─ 否则 → 默认（dev 项目根 / exe 同级 resources）
   manifest 缺失/无行为 → App.vue 显示 MissingResources
                                   └─「选择资源目录」→ 打开设置窗(resources)

设置窗:
  顶栏「更换目录」→ open(dialog) → pet_set_resource_root(path)
       ├─ 写 AppData/resource_path.txt
       ├─ 无 manifest.json → 写空白模板
       └─ 返回新 root → reload()（pet_read_manifest + pet_list_dirs）
  动作/跟随目录 → el-tree-select(dirTree) 选相对路径 / 选目录按钮选绝对路径
  保存 → pet_write_manifest → emit manifest-updated → 主窗热重载
```

## 错误处理

- `pet_set_resource_root`：目录不存在 / 写配置失败 / 写模板失败 → 返回 `Err(String)`，前端 `ElMessage.error`。
- `pet_list_dirs`：根目录不存在或不可读 → 返回空数组（不报错），树形下拉为空，用户仍可用「选目录」选绝对路径。
- AppData 配置文件读失败 → 视为未设置，回落默认逻辑（不崩溃）。

## 测试 / 验证

无测试框架。验证手段：
- `cargo check`（`src-tauri/`）类型通过。
- `pnpm build`（`vue-tsc --noEmit`）类型通过。
- 手动：删除 `resources/manifest.json` → 启动显示缺资源 → 选一个空目录 → 自动建模板 → 设置页能选目录树 → 配置动作保存 → 主窗热重载。重启后仍指向所选目录。

## 影响面 / 风险

- `resource_root` 签名变更牵动 4 处调用与 2 个命令签名 —— 改动集中在 `lib.rs`，风险可控。
- `el-tree-select` 显示绝对路径需合成节点，封装成 `DirSelect.vue` 降低重复与出错面。
- AppData 路径在 Windows 为 `%APPDATA%/com.example.duoduo/`（identifier 占位域名，后续正式分发改 identifier 时此路径随之变化，属预期）。
