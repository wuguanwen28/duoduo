# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: duoduo

A transparent, always-on-top, borderless Tauri 2 desktop window (fixed 620×400 logical px) that displays an animated cat sprite. The cat sits bottom-right-aligned in the window; the empty area is transparent and click-through. The cat tracks the cursor with its gaze, idles/sleeps on its own, and plays one-shot twitches (blink/tail/ear/feed/wiki).

All sprite frames live **outside the bundle** — in a `resources/` folder next to the exe (see "External resources" below). The app ships no frames; on launch it scans `resources/manifest.json`, and if nothing valid is found it shows a "缺资源" guide button instead of the cat. This lets users swap in a different cat, or add actions, **without rebuilding**.

The pet is **clamped to the union of all monitors' areas** at all times — it can be dragged across an extended desktop, but cannot go past the top/bottom/left/right edges of any monitor. The size slider scales the sprite image inside the fixed-size window (it does not resize the OS window).

Package name: `duoduo` (Tauri identifier `com.example.duoduo`).

## Stack & Tooling

- **Frontend**: Vue 3.5 (Composition API, `<script setup>`, TypeScript) + Vite 6 + Element Plus
- **Backend**: Tauri 2 (Rust, edition 2021). Commands: `pet_cursor_angle`, `pet_ctrl_pressed`, `pet_set_content_scale`, `pet_set_head_offset`, `pet_quit`, `pet_play_action`, `pet_scan_resources` + one tray icon
- **Package manager**: pnpm (lockfile is `pnpm-lock.yaml`)
- **No test runner, no linter, no CI configured.** `vue-tsc --noEmit` is the only type-check (runs as part of `pnpm build`); `cargo check` in `src-tauri/` type-checks the backend.

## Code conventions

- **`src/` 下的所有注释一律使用中文。** 包括 `.ts`/`.vue`/`.css` 里的行注释 `//`、块注释 `/* */`、JSDoc `/** */`，以及 Vue `<template>` 里的 `<!-- -->`。新增或修改代码时，注释必须写成中文（自然、专业的技术中文，不要逐字硬译），并尽量使用文档注释（JSDoc `/** */`）。
- 注释中出现的符号名、文件路径/行号、API 名（如 `pet_cursor_angle`、`useCatBrain`、`frame_XXXXXX.webp`）保持原样，只用中文写说明性文字。
- 此约定仅针对注释内容；标识符、字符串字面量、模板可见文本等代码本身不受影响。
- `src-tauri/` 的 Rust 注释暂不强制（如需统一可另行约定）。

## Commands

| Task | Command | Notes |
|---|---|---|
| Frontend dev server only | `pnpm dev` | Vite on `http://localhost:1420` (`strictPort: true`) |
| Type-check + frontend build | `pnpm build` | `vue-tsc --noEmit && vite build` → `dist/` |
| Preview built frontend | `pnpm preview` | |
| **Full Tauri dev (with hot reload)** | `pnpm app:dev` | Runs `pnpm dev` first, then launches the Tauri shell |
| **Full Tauri release build** | `pnpm app:build` | Runs `pnpm build`, then bundles a native app |
| Pass-through to Tauri CLI | `pnpm tauri <subcmd>` | |

The dev server pins port 1420 and HMR uses 1421. Vite is configured to ignore `src-tauri/**` so Rust edits do not trigger Vite reloads.

## Architecture

```
src/
  main.ts                       # createApp(App).mount("#app")
  App.vue                       # renders <Pet /> only
  styles.css                    # transparent body/window; user-select none
  components/
    Pet/Pet.vue                 # 窗口层事务：拖动 / 右键菜单 / 头部校准 / 提示 / 缩放 / 穿透
    Menu/Menu.vue               # 受控菜单面板（大小、透明度、偷看、穿透、校准、老板来了、下班）
    CatSprite/CatSprite.vue     # 纯展示：给一个帧 URL 就画一帧
  composables/
    useCatBrain.ts              # 行为状态机：组合 gaze + behavior，加权轮换 idle/sleep
    useGaze.ts                  # 角度 → 跟随帧（线性公式，见下）
    useBehavior.ts              # 播放一个 Behavior（enter→loop（base+随机插播）→exit）
    useSpriteAnimation.ts       # 通用逐帧播放器（fps 定时器，loop / 一次性）
  actions/
    frames.ts                   # 帧来源：从外置资源加载后填充（不再 import.meta.glob）
    clips.ts                    # 动作库（=manifest 的 actions）：dir/fps/yoyo/reverse/偏移
    behaviors.ts                # 行为库（idle/sleep）：base + random + enter/exit + 权重

src-tauri/
  Cargo.toml                    # lib name = duoduo_lib, crate-type = [staticlib, cdylib, rlib]
  tauri.conf.json               # 窗口、bundle、identifier、assetProtocol（enable + scope）
  capabilities/default.json     # Tauri 2 ACL（仅 core:* 权限；自定义命令无需在此登记）
  src/
    main.rs                     # 6 行 —— 调 duoduo_lib::run()
    lib.rs                      # 后端全部：注视 / 缩放 / 校准 / 托盘 / 外置资源扫描

resources/                      # 外置资源（exe 同级；dev 时为项目根的此目录）
  manifest.json                 # 资源清单（见下）
  follow/ *.webp                # 跟随光标的方向帧
  idle/<动作>/ *.webp           # 空闲行为的各动作目录（breathe/blink/tail/ear/feed/wiki）
  sleep/<动作>/ *.webp          # 睡觉行为的各动作目录（lieDown/breathe/ear/tail）
```

### External resources（核心特性）

帧不再打包进程序，而是放在 exe 同级的 `resources/` 下，由 `manifest.json` 描述结构与参数。换猫 / 加动作只改这个文件夹，无需重新编译。

**定位（`resource_root()` in `lib.rs`）**，优先级：
1. 环境变量 `DUODUO_RESOURCES`（手动覆盖，调试 / 多套素材）；
2. 开发模式（`debug_assertions`）：项目根的 `resources/`（用 `CARGO_MANIFEST_DIR` 的父目录推出）；
3. 发布模式：`current_exe()` 同级的 `resources/`。

**扫描（`pet_scan_resources` 命令）**：读 `manifest.json`，按 `follow` 和 `actions` 各自的 `dir` 列出帧文件**绝对路径**，并把这些目录加入 asset 协议白名单，一次性返回 `{ root, manifest, frames, error }`。`dir` 为绝对路径时直接用，否则相对资源根。支持的帧扩展名：webp/png/jpg/jpeg/gif/bmp，按文件名排序（零填充命名以保证字典序＝播放序）。

**前端加载**：拿到绝对路径后用 `convertFileSrc()`（`@tauri-apps/api/core`）转成 asset URL 喂给 `<img>`。`tauri.conf.json` 已开 `app.security.assetProtocol.enable=true`（scope `**`）。加载完成后才启动状态机；`error` 非空或缺 `idle` 行为时，前端显示「缺资源引导」按钮。

### manifest.json 格式

```jsonc
{
  "version": 1,
  // 跟随帧：靠线性公式按角度取帧，不用 anchors 表。
  "follow": { "dir": "follow", "clockwise": true, "startAngle": 0 },
  // 动作库（=旧 clips）。每个动作 = 一个独立文件夹，字段全部扁平：
  "actions": {
    "动作名": {
      "dir": "idle/blink",   // 必填：相对资源根 或 绝对路径
      "fps": 24,             // 必填
      "yoyo": true,          // 可选：来回播（正放 + 反放，去重端点）
      "reverse": true,       // 可选：倒放该目录的帧（如 wakeUp 复用 lieDown 目录倒放）
      "offsetX": -0.01,      // 可选：视觉水平偏移（占精灵直径比例）
      "offsetY": -0.01,      // 可选：视觉垂直偏移
      "scale": 1             // 可选：视觉缩放
    }
  },
  // 行为库（参与加权轮换）。行为里只写动作名，引用上面的 actions。
  "behaviors": {
    "idle": {
      "weight": 10, "duration": [15000,40000], "interruptible": true,
      "base": "idleBreathe",                       // 基底循环
      "random": [ { "action": "idleBlink", "weight": 5 }, … ],  // 随机插播
      "delay": [3000,8000]                         // 两次插播间隔 [min,max] ms
    },
    "sleep": {
      "weight": 2, "duration": [60000,120000],
      "enter": "lieDown", "exit": "wakeUp",        // 进入/退出转场动作
      "base": "sleepBreathe", "random": [ … ], "delay": [3000,7000]
    }
  }
}
```

### 行为状态机（`useCatBrain`）

两类状态：`behavior`（自治行为，如 idle/sleep）与 `follow`（跟随光标，抢占层）。

- **加权轮换**：每个行为有 `weight` + `duration`；进入后按 `duration` 排定时器，到点按 `weight` 加权随机挑下一个行为，跨行为切换会播离开者的 `exit`、进入者的 `enter`。idle 权重高、sleep 低，所以大部分时间待机、偶尔睡。
- **随机插播**：行为 loop 期间，每隔 `delay` 从 `random` 池按权重挑一个动作播一次，回到 `base`。
- **抢占跟随**：仅 `interruptible` 的行为（idle）在鼠标移动且光标不在死区时被抢占进 `follow`。
- **触发**：`trigger(name)` 先查行为（切过去待着）、再查动作（切到归属行为播一次）。供托盘 / 事件 / 将来的可视化设置调用，用于「切换动作」。`pet_play_action` 事件 → `trigger`。
- 菜单已不放固定的 sleep/feed 按钮（feed/wiki 现为 idle 的随机动作）；`trigger` 是保留下来的通用「切换动作」入口。

### 注视 / 跟随（`useGaze`）

1. `useCatBrain` 每 50ms 调 `pet_cursor_angle`，返回 `{ angle, cursor_x, cursor_y, over_cat }`。`angle` 是猫头到光标的顺时针**屏幕角度**（0=右,90=下），光标在头部死区内时为 `null`。
2. 死区内（`angle===null`）：`follow` 状态直接回落 `idle`，由待机帧表现「正视前方」——不再有专门的正视帧。
3. 跟随时：先转成时钟约定 `clock = (screenAngle + 90) % 360`（0=上,90=右,180=下,270=左），再按**线性公式**取帧：
   `index = round((clock − startAngle) / (360 / 帧数)) mod 帧数`（`clockwise:false` 时用 `startAngle − clock`）。
   这要求 follow 帧是**等角度均匀**分布的；换非均匀素材会有偏差。

### 头部校准

死区跟着猫头走，但不同素材猫头位置不同。菜单「校准猫头」拖一个绿圈对准猫头，存为 `head_offset`（相对精灵直径的比例，`localStorage` + `pet_set_head_offset` 同步给 Rust）。Rust 注视计算用它定位头部中心。

### Window drag

左键 `mousedown` 在猫身上：移动超阈值才 `startDragging()`（原生拖动会吞 dblclick，所以双击手动检测）；干净点击交给大脑（唤醒 / poke 随机动作）；双击最小化。右键留给菜单。权限 `core:window:allow-start-dragging`。

### 透明度 / 穿透点击 / 老板来了

- 透明度：菜单滑块改 `opacity`（最低 10%）。
- 穿透点击：`setIgnoreCursorEvents` 让透明区点击穿透到下层；开启「穿透」后整窗穿透，按住 Ctrl 临时恢复交互（穿透下窗口收不到键盘，故 Rust `pet_ctrl_pressed` 轮询 Ctrl）。
- 老板来了 / 下班：菜单「老板来了」最小化窗口；「下班」与托盘「退出」都 `app.exit(0)`。

### Tauri capabilities (ACL)

`src-tauri/capabilities/default.json` 是 `duoduo` 窗口的显式 allowlist。**自定义命令（`pet_*`）无需在此登记**，注册进 `invoke_handler` 即可被授权窗口调用；只有 `core:*` / 插件命令需要列权限。当前启用：`core:default`、`core:event:default`、`core:window:allow-*`（start-dragging / minimize / set-position / set-size / outer-position / inner-size / scale-factor / current-monitor / primary-monitor / available-monitors / set-ignore-cursor-events）。

## Important constraints / quirks

- 窗口 **decorations:false, transparent:true, shadow:false, alwaysOnTop:true, skipTaskbar:true, resizable:false**。窗口尺寸**只设一次**：容纳最大缩放的猫（右对齐，`PET_MAX_SCALE × PET_BASE_PX`）+ 左侧菜单预留（`fixed_window_size` in `lib.rs`），之后不再 resize。大小滑块只缩放窗口内的精灵图；`pet_set_content_scale` 仅缓存缩放（供注视/边界计算）并重新 clamp。改 `Menu.vue` 滑块 `:max` 时要同步 `lib.rs` 的 `PET_MAX_SCALE`。
- 边界：每次 `Moved` 事件把**猫的内容框**（非整窗）clamp 到所有显示器并集（`clamp_to_work_area`）。最小化时 Windows 把窗口停到 (-32000,-32000)，此时跳过 clamp 以免来回抖。
- 外置资源：程序不带任何帧。`resources/` 缺失 / `manifest.json` 解析失败 / 没有 idle 行为 → 显示缺资源引导，而非崩溃。follow/sleep/feed 等均可选，缺了对应功能静默关闭。
- follow 帧用线性公式按等角度取帧。换素材若帧数/朝向不同，需调 `manifest.json` 的 `follow.clockwise` / `startAngle`。
- Tauri identifier `com.example.duoduo` 是占位反向域名 —— 正式分发前改成自有域名。
- `src-tauri/gen/schemas/` 由 Tauri 构建生成、已 gitignore，不要编辑。
- `.vscode/sftp.json` 是个人远程上传配置（含凭据），忽略。
- `src/assets/cat-*` 是切出 `resources/` 之前的原始素材，保留作回退 / 重新切片用；不参与构建。

## Where to add new code

- 新动作（换猫 / 加动作）：在 `resources/` 下放一个帧文件夹，在 `manifest.json` 的 `actions` 里登记，并按需挂到某行为的 `base`/`random`/`enter`/`exit`。**无需改代码、无需重新编译。**
- 新 Tauri 命令：在 `src-tauri/src/lib.rs` 实现并注册到 `invoke_handler`。自定义命令无需改 capabilities；用到 `core:*` / 插件能力才加权限。
- 新 Vue 组件：放 `src/components/<Name>/`，文件夹一组件（同 `Pet/`、`Menu/`）。
- 新菜单项：改 `Menu.vue` 加一行 + `emit`，在 `Pet.vue` 接住处理（本地 handler 调命令或 `trigger`）。无需 Tauri 事件往返。

## 注意事项
- 回答我的问题时都要叫我老大。
- 注释要使用中文，并且使用文档注释。
