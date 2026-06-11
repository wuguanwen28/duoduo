# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: duoduo

A transparent, always-on-top Tauri 2 desktop window (500×500) that displays a 169-frame cat sprite. The cat tracks the cursor with its gaze. Right-clicking the pet toggles an in-window menu panel (size slider, follow-cursor toggle, sleep/feed/quit actions). Quit is available via either the system tray menu's "退出" item, the in-window menu's "下班" item, or the system close button (the window has decorations on).

The pet is **clamped to the union of all monitors' areas** at all times — it can be dragged across an extended desktop, but cannot go past the top/bottom/left/right edges of any monitor. The size slider scales the sprite image inside the fixed-size window (it does not resize the OS window).

Package name: `duoduo` (Tauri identifier `com.example.duoduo`).

## Stack & Tooling

- **Frontend**: Vue 3.5 (Composition API, `<script setup>`, TypeScript) + Vite 6
- **Backend**: Tauri 2 (Rust, edition 2021). Three commands (`pet_cursor_angle`, `pet_set_size`, `pet_quit`) + one tray icon
- **Package manager**: pnpm (lockfile is `pnpm-lock.yaml`)
- **No test runner, no linter, no CI configured.** `vue-tsc --noEmit` is the only type-check (runs as part of `pnpm build`)

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
  components/Pet/Pet.vue        # the whole app: gaze loop + drag + in-window menu
  components/Menu/Menu.vue      # controlled menu panel (size slider, follow toggle, actions)
  assets/cat/frame_000000.png
            …
            frame_000168.png    # 169 PNG frames, ~600–700KB each, eagerly bundled

src-tauri/
  Cargo.toml                    # lib name = duoduo_lib, crate-type = [staticlib, cdylib, rlib]
  build.rs                      # tauri_build::build()
  tauri.conf.json               # window, bundle, identifier
  capabilities/default.json     # Tauri 2 ACL for the single "pet" window
  icons/                        # standard Tauri icon set
  src/
    main.rs                     # 6 lines — calls duoduo_lib::run()
    lib.rs                      # the real backend: pet_cursor_angle + pet_set_size + pet_quit + tray
```

### The gaze loop (the only meaningful logic)

1. `Pet.vue:onMounted` starts a `setInterval(tick, 50)` — about 20 fps.
2. Each tick calls `invoke<number | null>("pet_cursor_angle")` (defined in `src-tauri/src/lib.rs:13-30`).
3. The Rust command returns the **clockwise degrees from the pet-window's center to the global cursor**, in screen convention (0° = +x/right, 90° = down). Returns `null` when the cursor sits exactly on the center.
4. `Pet.vue:tick` converts to the internal "clock" convention (0° = up): `clock = (screen + 90) % 360`.
5. `angleToFrame(clock)` does a piecewise-linear lookup against the 9-entry `ANCHORS` table (`Pet.vue:32-42`) — angles are in degrees, values are frame indices. The result is rounded and used as the index into the `frames` array.

Frames are eagerly loaded at build time with `import.meta.glob("../../assets/cat-webp/*.webp", { eager: true })` so the in-browser array index equals the frame number (the key sort is what guarantees ordering — do not assume lex order; the filenames are zero-padded 6-digit and lex-sorted happens to be numeric order). The `cat/` directory keeps the original PNGs in case the WebPs need to be re-exported.

### Window drag

Left-button `mousedown` on the pet calls `getCurrentWindow().startDragging()`. Other buttons (notably right-click) are left untouched so the in-window menu can be toggled instead. Permission: `core:window:allow-start-dragging` in `capabilities/default.json`.

### In-window menu

Right-clicking the sprite toggles `menuOpen` in `Pet.vue`. A full-window backdrop covers the pet; a 200×260 panel anchored to the top-right renders `<Menu>`. The menu is closed by the × button, the Esc key, or clicking the backdrop. `Menu.vue` is a controlled component: `Pet.vue` owns `size` and `followCursor` and passes them in; the menu emits `update:size`, `update:follow`, `close`, `sleep`, `feed`, `quit`. There is no Tauri event round-trip — actions like quit call `invoke("pet_quit")` directly.

### Tauri capabilities (ACL)

`src-tauri/capabilities/default.json` is the explicit allowlist for the single `pet` window. It must list any new `invoke` command's permission before the frontend can call it. Currently enabled:

- `core:default`, `core:event:default`
- `core:window:allow-start-dragging`, `set-position`, `set-size`, `outer-position`, `inner-size`, `scale-factor`, `current-monitor`, `primary-monitor`, `available-monitors`, `set-ignore-cursor-events`

## Important constraints / quirks

- The window is **decorations: true, transparent: true, shadow: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, 500×500, anchored at (600, 600)** — see `tauri.conf.json`. `resizable: false` is set because the in-window size slider only scales the sprite image (it does not resize the OS window), so user-driven resize would conflict.
- Quit has three paths: the tray-icon "退出" item, the in-window menu's "下班" item, and the system close button. All three terminate the app.
- Bounds: the pet is clamped to the union of all monitors' areas on every move event (see `clamp_to_work_area` in `src-tauri/src/lib.rs`). The pet can be dragged freely across an extended desktop but cannot go past the top/bottom/left/right edge of any monitor.
- The Tauri identifier `com.example.duoduo` is a placeholder reverse-DNS — change to your own domain before any real distribution.
- The Rust command's angles and the Vue-side `ANCHORS` table are tuned to a **clockwise** gaze loop. If frame 0 is replaced or frames are re-ordered, both the anchor indices and the `clock = (screen + 90) % 360` conversion must be re-verified — `.tmp_montage/` in the repo root holds scratch images from when the anchor map was calibrated (ignore it; not part of the build).
- `src-tauri/gen/schemas/` is generated by Tauri on build and is gitignored — do not edit.
- `.vscode/sftp.json` is a personal remote-upload config (contains credentials); ignore it.

## Where to add new code

- New Vue components: drop under `src/components/<Name>/` with a folder-per-component convention (matches `Pet/`, `Menu/`).
- New Tauri commands: implement in `src-tauri/src/lib.rs`, register in the `invoke_handler` list, and add the matching `core:*:allow-*` (or custom) permission in `src-tauri/capabilities/default.json` before calling from JS.
- New menu items: edit `src/components/Menu/Menu.vue` to add a row, then add a matching `emit('<name>')` and handle it in `Pet.vue` (a local handler that either invokes a Rust command or shows a toast). No Tauri event wiring is needed.
- New sprite frames: drop into `src/assets/cat/` with the `frame_000XXX.png` zero-padded naming, then re-run the WebP conversion (the `cat-webp/` directory is what's actually bundled). The `import.meta.glob` is non-recursive and glob-ordered, so consistent padding keeps the index math intact.
</content>
</invoke>

## 注意事项
- 回答我的问题时都要叫我老大