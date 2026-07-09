# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: duoduo

`duoduo` is a Tauri 2 desktop pet app: a transparent, always-on-top, borderless Windows desktop window that renders an animated cat sprite. The sprite frames live outside the application bundle in a user-swappable `resources/` folder. The pet can track the cursor, idle/sleep via a behavior state machine, play one-shot actions, show a configurable radial menu, and open a separate settings window for resources, display/interaction, tools, and updates.

Package name: `duoduo`; Tauri identifier is currently the placeholder `com.example.duoduo`.

## Stack & tooling

- **Desktop app frontend**: Vue 3.5 + TypeScript + Vite 6 + Element Plus, using Composition API and `<script setup>`.
- **Desktop app backend**: Tauri 2 + Rust 2021. Custom commands are registered in `src-tauri/src/lib.rs`; Tauri plugins include dialog and global-shortcut.
- **Package manager**: pnpm; root lockfile is `pnpm-lock.yaml`.
- **Validation**: no test runner, linter, or CI test job is configured. `pnpm build` runs `vue-tsc --noEmit && vite build`; `cargo check` in `src-tauri/` type-checks Rust.
- **Optional nested server**: `server/` is a separate Nuxt 3 + Prisma + MySQL admin/update server with its own `package.json`, `pnpm-lock.yaml`, `.git`, and `.env.example`. It is ignored by the root repo.

## Code conventions

- **All comments under `src/` must be Chinese.** This includes `.ts`, `.vue`, `.css`, JSDoc/block/line comments, and Vue template comments. Use natural technical Chinese; prefer JSDoc-style documentation comments for newly added explanations.
- Symbol names, API names, paths, and examples inside comments stay as-is; only explanatory text should be Chinese.
- This convention applies to comments only. Identifiers, string literals, and visible UI copy are not constrained by it.
- Rust comments in `src-tauri/` are not strictly forced, but most existing module comments are Chinese; match nearby style.
- When answering the user, call them “老大”.

## Common commands

### Root desktop app

| Task | Command | Notes |
|---|---|---|
| Install deps | `pnpm install` | Root app only. |
| Vite dev server | `pnpm dev` | Serves `http://localhost:1420`; strict port. |
| Full Tauri dev | `pnpm app:dev` | Runs `tauri dev`; Tauri starts `pnpm dev` via config. |
| Type-check + frontend build | `pnpm build` | `vue-tsc --noEmit && vite build`; outputs `dist/`. |
| Preview built frontend | `pnpm preview` | Vite preview. |
| Tauri release build + package | `pnpm app:build` | `tauri build && node scripts/package.mjs`. |
| Package existing Tauri output | `pnpm pack:only` | Runs only `scripts/package.mjs`. |
| Rust type-check | `cd src-tauri && cargo check` | Backend-only check. |
| Tauri CLI passthrough | `pnpm tauri <subcmd>` | Uses `@tauri-apps/cli`. |
| Release | `pnpm release <version>` | Requires clean worktree; commits, tags, pushes to `github`, then best-effort `origin`. |
| Publish mirrors | `pnpm publish:mirrors` | Downloads GitHub Release artifacts, validates sha256, mirrors to Gitee/server. |

Vite uses two HTML entries (`index.html` and `settings.html`). Dev server port is 1420; HMR uses 1421 when `TAURI_DEV_HOST` is set. Vite watch ignores `src-tauri/**` and `server/**`.

### Nested `server/` app

Run these from `server/`, not the root:

| Task | Command | Notes |
|---|---|---|
| Install deps | `pnpm install` | Generates Prisma client via `postinstall`. |
| Nuxt dev | `pnpm dev` | Admin/update server. |
| Build | `pnpm build` | Nuxt build. |
| Preview | `pnpm preview` | Nuxt preview. |
| Prisma dev migration | `pnpm prisma:migrate` | `prisma migrate dev`. |
| Prisma deploy migration | `pnpm prisma:migrate:deploy` | Production migration deploy. |
| Generate Prisma client | `pnpm prisma:generate` | `prisma generate`. |
| Prisma Studio | `pnpm prisma:studio` | DB inspection UI. |
| Seed DB | `pnpm prisma:seed` | Runs `npx tsx prisma/seed.ts`. |

`server/.env.example` documents required environment variables. Do not read or expose `server/.env` contents.

## High-level architecture

### Frontend entries

- `index.html` mounts `src/pet-window/main.ts`, which renders the transparent pet window app.
- `settings.html` mounts `src/settings/main.ts`, which renders the normal settings window.
- `vite.config.ts` builds both entries via Rollup input names `main` and `settings`.

### `src/pet-core/` — shared domain/state logic

This folder is the shared model layer used by both the pet window and settings window.

- `resources.ts` scans external resources through Tauri commands, converts file paths with `convertFileSrc()`, and populates runtime action/behavior/frame registries.
- `clips.ts`, `behaviors.ts`, and `useBehavior.ts` represent manifest actions and autonomous behavior loops.
- `useCatBrain.ts` orchestrates behavior state, follow state, wake/poke/trigger behavior, and one-shot actions.
- `useGaze.ts` maps backend cursor angle samples to follow frames.
- `useSpriteAnimation.ts` is the generic frame player.
- `commands.ts` is the executable pet-action registry used by gestures, shortcuts, and settings dropdowns.
- `triggerBindings.ts` stores the unified trigger binding model: fixed mouse gestures plus dynamic keyboard shortcuts.
- `basicSettings.ts`, `displaySettings.ts`, `menuSettings.ts`, and `speakPhrases.ts` are file-backed reactive settings (persisted to `~/.duoduo/` via `appSettings`) with cross-window Tauri-event synchronization.

Settings synchronization generally follows a one-way pattern: settings UI saves/broadcasts; the pet window listens and applies. Avoid broadcasting from the pet window unless the file explicitly supports it.

### Persisted data layout (`~/.duoduo/`)

- `setting.json` — global: `version`, `activeCatId`, `updateDismiss`, and `cats: { <id>: { name, birthday, gender, tags, description } }` (the **identity profile**; used by card list / cat picker so they need not open every cat file).
- `cats/<id>.json` — per-cat **behavior config**: `display`, `menu`, `speakPhrases`, `speakPhrasesDefault`, `triggerBindings`, `windowPos`, and `resourceRoot`. Writing one cat never touches another (no races, no cat loss).
- `avatars/<id>.png` — per-cat avatar image; **file existence is the sole source of truth** for "has avatar" (no `hasAvatar` flag).
- `app-icon.png` — custom app/tray icon; global, decoupled from any cat's resource root.

`resourceRoot` is a **server-owned field**: `pet_save_cat` preserves the on-disk value (only `pet_set_resource_root` may change it), so a pet window's full-file snapshot (e.g. on `windowPos` save) cannot clobber the resource root a settings window just set. Identity (basic) is written to `setting.json` by `saveNow`; behavior is written to `cats/<id>.json`.

### `src/pet-window/` — transparent pet window

- `PetApp.vue` loads external resources before mounting `<Pet>`. If resource loading fails or required behavior data is missing, it shows `MissingResources` instead of the pet.
- `components/Pet/Pet.vue` is the main window coordinator: sprite rendering, drag, gestures, radial menu, head calibration, opacity, click-through, global shortcuts, and invoking Tauri commands.
- `components/CatSprite/CatSprite.vue` is pure frame display.
- `components/Menu/Menu.vue` renders the configurable radial menu.
- `components/SpeechBubble/SpeechBubble.vue` shows configured speech phrases.
- `composables/useGestures.ts` recognizes left click, double click, right click, and long press on the cat body. Dragging remains a fixed Tauri native drag behavior and is not part of configurable gestures.

The main window is transparent, borderless, always-on-top, skip-taskbar, non-resizable, and initially hidden until Rust positions it. Transparent background uses `pointer-events: none`; interactive children re-enable pointer events locally.

### `src/settings/` — settings window

`SettingsApp.vue` renders a normal decorated settings window with Element Plus and a left navigation rail:

- `basic/` edits pet name/avatar/birthday/gender.
- `resource/` edits `resources/manifest.json`, actions, behaviors, and resource dirs; saving emits `manifest-updated` so the pet window hot-reloads resources.
- `display/` edits size, opacity, always-on-top, click-through, radial menu items, speech phrases, and trigger bindings.
- `tools/VideoToWebp.vue` implements video-to-WebP frame extraction; decoding/chroma-key/WebP encoding happen in the WebView with `<video>` + Canvas, then Rust writes frames to disk.
- `update/UpdateSettings.vue` drives update check/download/apply and the about links.

The settings window (label `settings`) is defined in `tauri.conf.json` and starts hidden; `window::open_settings` / `toggle_settings` show and focus it. It loads `settings.html`, remembers its last logical size in memory, and supports opening directly to a tab via `pet_open_settings(tab)` / `pet_consume_pending_tab` / `navigate-to`.

### `src-tauri/` — Rust backend

`src-tauri/src/lib.rs` only assembles modules, plugins, managed state, command registration, window events, tray setup, initial positioning, custom icon loading, and update cleanup. Feature code is split into modules:

- `state.rs`: shared `PetState`, including scale, head offset, tray icon, pending settings tab, settings size, and download state.
- `geometry.rs`: fixed pet window sizing, content-scale caching, monitor-union clamping, and work-area bounds.
- `gaze.rs`: cursor sampling, head-offset calibration, dead-zone detection.
- `window.rs`: pet visibility, settings-window creation/navigation, quit, Ctrl polling, frontend action events, and opening external URLs.
- `resources.rs`: per-cat resource root resolution, manifest read/write, frame scanning, and directory listing.
- `converter.rs`: validates resource subdirectories and writes generated `.webp` frames.
- `icon.rs`: save/reset/load custom app/window/tray icon.
- `tray.rs`: system tray icon and menu.
- `updater.rs`: self-update check/download/apply logic.

Custom `pet_*` commands must be implemented in a module and registered in `tauri::generate_handler!` in `lib.rs`. Tauri 2 custom commands do not need capability entries; only core/plugin permissions do.

## External resources and manifest

The app ships no sprite frames. Frames are loaded from each cat's `manifest.json` and the folders under that cat's resource root.

Resource root is **per-cat**: each cat's `cats/<id>.json` carries its own `resourceRoot` (a behavior-layer field, see below). `resources::resource_root(app, cat_id)` resolves per cat:

1. `DUODUO_RESOURCES` environment variable (global dev override; **when set, per-cat is disabled** — all cats share this root).
2. That cat's `resourceRoot` if it points at a valid directory.
3. Only the default cat `"default"` falls back to the bundled `resources/` (debug: repo-root `resources/` from `CARGO_MANIFEST_DIR`; release: `resources/` next to the exe).
4. Otherwise `None` — the cat has no assets yet; the pet window shows the `MissingResources` guide directing the user to resource settings to pick a directory.

`pet_scan_resources(catId)` reads the manifest, resolves `follow.dir` and every action `dir`, lists supported image extensions (`webp/png/jpg/jpeg/gif/bmp`) by filename order, and returns absolute paths. A cat with no resource root returns an `error` instead of crashing. The frontend converts those to asset URLs with `convertFileSrc()`. `tauri.conf.json` enables the asset protocol with scope `**`.

Manifest shape:

```jsonc
{
  "version": 1,
  "follow": { "dir": "follow", "clockwise": true, "startAngle": 0 },
  "actions": {
    "idleBlink": {
      "dir": "idle/blink",
      "fps": 24,
      "yoyo": true,
      "reverse": false,
      "offsetX": -0.01,
      "offsetY": -0.01,
      "scale": 1
    }
  },
  "behaviors": {
    "idle": {
      "weight": 10,
      "duration": [15000, 40000],
      "interruptible": true,
      "base": "idleBreathe",
      "random": [{ "action": "idleBlink", "weight": 5 }],
      "delay": [3000, 8000]
    }
  }
}
```

External resource failure must be non-fatal: missing folder, manifest parse failure, or missing required `idle` behavior should show the missing-resources guide rather than crashing. Optional follow/sleep/action assets should fail gracefully where possible.

## Behavior, gaze, triggers, and interaction

### Behavior state machine

`useCatBrain` has two major visual modes: autonomous `behavior` and cursor `follow`.

- Behaviors are weighted by `weight` and run for randomized `duration` ranges.
- A behavior may have `enter`, `base`, `random`, `delay`, and `exit` action names.
- Random insert actions are selected by weight and then return to `base`.
- Cursor follow can preempt only interruptible behaviors.
- `trigger(name)` first checks behavior names, then action names, so the same entry point can switch long-running behavior or play a one-shot action.

### Gaze / follow frames

`pet_cursor_angle` returns `{ angle, cursor_x, cursor_y, over_cat }`. `angle` is a clockwise screen angle where 0=right and 90=down; it is `null` when the cursor is inside the head dead zone.

Follow frame selection converts to clock angle with `clock = (screenAngle + 90) % 360`, then uses an evenly-spaced linear formula:

```ts
index = round((clock - startAngle) / (360 / frameCount)) mod frameCount
```

When `follow.clockwise === false`, the direction is inverted. Follow assets are assumed to be evenly distributed by angle; non-uniform assets need manifest tuning.

### Head calibration

Head offset is stored as a ratio of sprite diameter in the cat's `display.headOffset` (`cats/<id>.json`) and synchronized to Rust through `pet_set_head_offset`. Rust uses it to compute the gaze origin and dead zone. Calibration UI lives in the pet window/menu flow.

### Gesture and shortcut model

`triggerBindings.ts` unifies mouse gestures and keyboard shortcuts:

- Mouse bindings are the first fixed concepts: `leftClick`, `doubleClick`, `rightClick`, `longPress`. Their triggers are not editable; their actions are.
- Key bindings are dynamic and may be app-local or global. Global shortcuts use `@tauri-apps/plugin-global-shortcut` and accelerator conversion from `toAccelerator()`.
- Settings changes are persisted to `cats/<id>.json` (via `appSettings.scheduleSave`) and broadcast through `trigger-bindings-changed`; the pet window reapplies all bindings and emits `trigger-bindings-result` with failed global registrations so settings can mark conflicts.
- Available actions come from `PET_ACTIONS` in `commands.ts`; expose labels and allowed action-key lists there when adding a new bindable action.

Dragging is intentionally separate: left-button movement beyond threshold calls `getCurrentWindow().startDragging()` and is not configurable.

### Click-through and Ctrl recovery

The transparent window normally lets empty space click through. Enabling click-through can make the whole window ignore cursor events; because that prevents keyboard events from reaching the window, Rust polls Ctrl with `pet_ctrl_pressed` so holding Ctrl temporarily restores interaction.

## Tauri windows and capabilities

- Settings window label: `settings`; defined in `tauri.conf.json` as a normal decorated, resizable window loading `settings.html`, with `visible:false` on startup. It doubles as the bootstrap entry: `src/settings/main.ts` runs `bootstrapIfEmpty` + `loadAppSettings`, then invokes `pet_show_cat_window` to bring up the default cat window — so on launch only the cat appears, not the settings UI. The settings window is shown later via tray / `pet_open_settings` / `toggle_settings`.
- Cat window label: `cat-<id>` (one per cat); created dynamically by `window::show_cat_window` — transparent, borderless, always-on-top, skip-taskbar, no shadow, non-resizable, built hidden then positioned at the bottom-right of the current monitor work area and shown to avoid flash.
- Settings window close (×) = hide to tray (tray "退出" is the real quit); cat window close = destroy that window.
- `src-tauri/capabilities/default.json` lists `duoduo`, `settings`, and `cat-*` and allows required core window APIs plus global-shortcut permissions.
- `src-tauri/capabilities/settings.json` separately allows settings-window defaults, close/minimize, and dialog open.
- If using new Tauri core/plugin APIs from frontend, add the corresponding capability permission. Do not add permissions for custom `pet_*` commands.

## Window sizing and monitor clamp quirks

- The OS window size is fixed to fit the maximum scaled cat plus menu reserve; the size slider scales sprite content only.
- `pet_set_content_scale` updates backend scale state used by gaze and clamping; it should not resize the OS window.
- If changing frontend maximum pet scale, keep it synchronized with `PET_MAX_SCALE` in `src-tauri/src/geometry.rs`.
- `Moved` events clamp the pet content frame, not merely the whole transparent window, to the union of all monitor work areas.
- When minimized, Windows parks the window at `(-32000, -32000)`; clamping is skipped while minimized to avoid event ping-pong/freezes.

## Video-to-WebP tool

The conversion tool is split deliberately:

- Frontend (`src/settings/tools/VideoToWebp.vue`, `chromaKey.ts`, `frameCache.ts`) handles video decoding, frame stepping, chroma key processing, caching, and WebP encoding using browser APIs.
- Rust (`converter.rs`) only creates the target directory, optionally clears old `.webp` files, and writes received frame bytes.
- **Output directory is user-chosen** (system directory picker), defaulting to `<video parent dir>/<video name without ext>_帧图片`. It is no longer forced under the resource root — `pet_converter_begin(dir, clear)` takes an absolute path and only rejects `..` traversal components. Generated frames can then be referenced from the manifest via an absolute `dir`.

## Hot update and release flow

`src-tauri/src/updater.rs` updates only the exe; it never modifies `resources/`.

- Check/download fallback order is Gitee → GitHub → server. `SERVER_BASE` is currently a placeholder and must be replaced before real server distribution.
- Windows self-replacement uses rename-dance: current exe → `.old`, downloaded `.new` → current exe, spawn new process, exit old process. Debug builds disable self-replacement.
- Progress is emitted as `update://progress` with `{ downloaded, total }` and shown in settings.
- The authoritative binary is the GitHub Actions artifact from GitHub Release. Mirrors must redistribute that exact exe/version pair so sha256 matches across fallback sources.

Release flow:

1. `pnpm release <version>` synchronizes versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`; updates changelog when possible; commits; tags; pushes `master` and tag to `github`; best-effort pushes to `origin`.
2. `.github/workflows/release.yml` triggers only on `v*` tags, builds on Windows, runs `pnpm app:build`, and publishes artifacts.
3. `pnpm publish:mirrors` downloads the GitHub Release `duoduo.exe` and `version.json`, validates sha256, then mirrors to Gitee/server.

Remote naming is assumed by scripts: `github` is GitHub and `origin` is Gitee.

CI cache notes:

- `release.yml` must remain tag-triggered without `paths` filters, otherwise tag releases can be skipped.
- 发版前不再预热缓存：tag 触发的 release run 跨 tag 互相隔离、读不到彼此缓存，故每次发版全量编译 Rust 依赖（~7 分钟）。这是有意的简化，不维护养缓存工作流。
- Rust release profile uses `opt-level=1` and `strip=true` to reduce CI build/link time for this low-runtime-load app.

### 提交信息与 changelog 规范

CHANGELOG.md 由 `cliff.toml` 通过 git-cliff 从 conventional commits 自动生成，面向终端用户，只收录 `feat`/`fix`/`perf`；`ci`/`build`/`chore`/`refactor`/`docs` 等前缀默认已跳过。

但有些提交虽然语义上是 `feat`/`fix`，内容却与用户可感知的软件功能无关——例如 CI 流程调整、构建脚本修复、依赖升级、配置脚手架等内部改动。这类提交若直接用 `feat`/`fix` 前缀，会被误收入用户面向的更新日志。处理方式：在提交信息正文末尾追加 footer `changelog: ignore`，git-cliff 命中后即跳过、不进 CHANGELOG（见 `cliff.toml` 的 `commit_parsers` 首条规则）。

写法：

```
fix: 修正发版脚本的版本号同步逻辑

仅影响发布流程，用户无感。

changelog: ignore
```

判定标准：若该改动用户在 release notes 里看到会困惑或无感（"这跟我有什么关系"），就加 `changelog: ignore`；若确实是新功能或用户能遇到的 bug 修复，则正常进日志、不加该标记。

## Nested `server/` architecture

`server/` is not part of the root desktop app repo history and is ignored by root `.gitignore`, but it is present in this working tree.

- Stack: Nuxt 3, Element Plus, Prisma 6, MySQL, JWT (`jose`), bcrypt.
- Pages: admin login/dashboard/releases/assets plus public index.
- API: admin CRUD/upload/publish/prune endpoints under `server/api/admin/**`, public assets list, stat collection, and `/duoduo/version.json` route.
- Prisma schema models include admin users, releases, asset packs, and stats.
- Environment variables include DB URL, JWT secret, admin credentials, static storage directory, and retention count.
- Treat `server/.env` as sensitive. Use `.env.example` for documentation.

## Where to add new code

- New sprite action/behavior: prefer editing `resources/manifest.json` through the settings UI or directly. Add frame folders under `resources/` and reference action names in behaviors. No rebuild is needed for normal resource changes.
- New bindable pet action: add implementation and labels/allowed keys in `src/pet-core/commands.ts`; wire UI only if the action needs custom controls.
- New trigger type: extend `src/pet-core/triggerBindings.ts`, settings display code under `src/settings/display/`, and dispatch logic in the pet window.
- New radial menu built-in: update `src/pet-core/menuSettings.ts`, `Menu.vue`, and the handler path in `Pet.vue`.
- New setting shared by pet/settings windows: put the reactive storage/event module in `src/pet-core/` and follow the existing single-direction broadcast pattern.
- New settings page: add a component under `src/settings/<area>/` and register it in `SettingsApp.vue` navigation.
- New Tauri command: implement in the appropriate `src-tauri/src/*.rs` module, register in `lib.rs`, and add frontend command wrapper/use site. Add capabilities only for new core/plugin APIs.
- New backend module: prefer adding a focused Rust module rather than growing `lib.rs`.
- New server admin/API feature: work inside `server/`, using its own package scripts and Prisma workflow.

## Important constraints / quirks

- Do not edit `src-tauri/gen/schemas/`; it is generated and ignored.
- Root `.gitignore` intentionally ignores `.vscode/`, `.claude/`, `src-tauri/target/`, package/mirror outputs, and `server/`.
- `src/types/auto-imports.d.ts` and `src/types/components.d.ts` are generated by unplugin but committed because `vue-tsc` runs before Vite in clean CI; update and commit them when auto-imported APIs/components change.
- `src/assets/cat-*` are old/raw sprite assets retained for fallback or re-slicing; runtime sprites come from external `resources/`.
- `.vscode/sftp.json` is a personal remote-upload config and may contain credentials; ignore it.
- `com.example.duoduo` is a placeholder identifier; change before formal public distribution.
- Current root working tree may contain generated or local changes. Check `git status` before editing and avoid overwriting user work.
