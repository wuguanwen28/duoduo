<template>
  <div class="pet" @keydown.esc="menuOpen = false" @contextmenu.prevent>
    <!-- Right-click the cat to open the menu. el-popover handles the
         contextmenu trigger, outside-click close, and the open/close
         animation; :teleported="false" keeps the panel inside the 500×500
         window instead of escaping to <body>. -->
    <el-popover
      v-model:visible="menuOpen"
      trigger="contextmenu"
      placement="left-end"
      :width="200"
      :teleported="false"
      :show-arrow="false"
      :persistent="false"
      popper-class="pet-menu-popover"
    >
      <template #reference>
        <div
          class="pet__img-wrap"
          :style="imgStyle"
          @mousedown="onMouseDown"
          @contextmenu.prevent
        >
          <img class="pet__img" :src="currentSrc" alt="cat" draggable="false" />
        </div>
      </template>
      <Menu
        :size="size"
        :follow="followCursor"
        @update:size="size = $event"
        @update:follow="onToggleFollow"
        @calibrate="startCalibrate"
        @boss="onMinimize"
        @close="menuOpen = false"
        @quit="onQuit"
        @sleep="onSleep"
        @feed="onFeed"
      />
    </el-popover>

    <!-- Calibration overlay: covers the full window while calibrating. -->
    <div
      v-if="calibrating"
      class="pet__calib-overlay"
      @contextmenu.prevent.stop
    >
      <div class="pet__calib-instructions">拖动圆圈到猫头位置</div>
      <div
        class="pet__calib-circle"
        :style="calibCircleStyle"
        @mousedown="onCalibMouseDown"
      ></div>
      <div class="pet__calib-actions">
        <el-button type="primary" size="small" @click="confirmCalibrate"
          >确认</el-button
        >
        <el-button size="small" @click="cancelCalibrate">取消</el-button>
      </div>
    </div>

    <Transition name="toast">
      <div v-if="toast" class="pet__toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Menu from "../Menu/Menu.vue";

/**
 * Eagerly import every cat frame. Vite returns a map keyed by the file path;
 * sorting the keys gives us frame_000000 … frame_000168 in order, so the array
 * index equals the frame number. (Frames are kept as compressed WebP under
 * `cat-webp/`; the original PNGs are in `cat/` if you need to re-export.)
 */
const modules = import.meta.glob<string>("../../assets/cat-webp/*.webp", {
  eager: true,
  import: "default",
});
const frames: string[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k]);
const FRAME_COUNT = frames.length;

/**
 * Gaze map: (clock angle → frame index), where the clock angle is measured
 * with 0° = looking UP and increases CLOCKWISE (90° = right, 180° = down,
 * 270° = left). These anchors were read off the actual sprites; the gaze
 * makes exactly one clockwise loop across the sequence.
 */
const ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 15], // up
  [45, 45], // up-right
  [90, 63], // right
  [135, 81], // down-right
  [180, 93], // down
  [225, 108], // down-left
  [270, 120], // left
  [315, 135], // up-left
  [360, 168], // up (loop close)
];

/** Piecewise-linear lookup: clock angle (0..360) → frame index. */
function angleToFrame(clock: number): number {
  const a = ((clock % 360) + 360) % 360;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a0, f0] = ANCHORS[i];
    const [a1, f1] = ANCHORS[i + 1];
    if (a >= a0 && a <= a1) {
      const t = (a - a0) / (a1 - a0);
      return Math.round(f0 + t * (f1 - f0));
    }
  }
  return 0;
}

const frameIndex = ref(0);
const currentSrc = computed(
  () => frames[Math.min(frameIndex.value, FRAME_COUNT - 1)] ?? frames[0],
);

const size = ref(1.0);
const imgStyle = computed(() => {
  const px = Math.round(200 * size.value);
  return { width: `${px}px`, height: `${px}px` };
});

// Calibration circle: same size as dead-zone, uses green colour, draggable.
const calibCircleStyle = computed(() => {
  const d = Math.round(200 * size.value * 0.1225);
  const ox = Math.round(200 * size.value * headOffset.value.x);
  const oy = Math.round(200 * size.value * headOffset.value.y);
  return {
    width: `${d}px`,
    height: `${d}px`,
    left: `calc(50% + ${ox}px)`,
    top: `calc(50% + ${oy}px)`,
  };
});

// Mirror the sprite scale to Rust so its on-screen-clamp constrains the actual
// cat content (centered in the oversized window), not the window frame. Fires
// immediately so the backend starts with the correct scale.
watch(
  size,
  (s) => {
    invoke("pet_set_content_scale", { scale: s }).catch(() => {
      // Ignore — backend may not be ready during teardown.
    });
  },
  { immediate: true },
);

/** When false, the pet ignores the cursor and locks to the forward sprite
 *  (frame 0). Toggled from the in-window menu's "是否跟随" switch. */
const followCursor = ref(true);

/** In-window menu state. */
const menuOpen = ref(false);

// Resize the window when the menu opens/closes so it's just big enough for the
// cat (+ menu when open). The Rust command shifts the window leftward when
// opening so the cat doesn't jump on screen.
watch(menuOpen, (open) => {
  invoke("pet_resize_for_menu", { open }).catch(() => {});
});

// ── Head calibration ─────────────────────────────────────────────────
// Ratio of the head offset to the sprite's *diameter* so it stays stable
// across size changes. (0,0) = image centre, (0,-0.2) = slightly above.
const calibrating = ref(false);
const headOffset = ref<{ x: number; y: number }>({ x: 0, y: 0 });

// Load persisted offset on startup.
try {
  const raw = localStorage.getItem("pet-head-offset");
  if (raw) {
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      headOffset.value = parsed;
    }
  }
} catch {
  /* corrupt — ignore */
}

function startCalibrate() {
  menuOpen.value = false;
  calibrating.value = true;
}

function confirmCalibrate() {
  localStorage.setItem("pet-head-offset", JSON.stringify(headOffset.value));
  invoke("pet_set_head_offset", {
    x: headOffset.value.x,
    y: headOffset.value.y,
  }).catch(() => {});
  calibrating.value = false;
  showToast("猫头位置已校准 ✓");
}

function cancelCalibrate() {
  calibrating.value = false;
}

// ── Drag handling (calibration mode) ─────────────────────────────────
const dragAnchor = ref<{ x: number; y: number } | null>(null);
const dragStartOffset = ref<{ x: number; y: number }>({ x: 0, y: 0 });

function onCalibMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  dragAnchor.value = { x: e.clientX, y: e.clientY };
  dragStartOffset.value = { ...headOffset.value };
  e.preventDefault();
  e.stopPropagation();
}

function onCalibMouseMove(e: MouseEvent) {
  if (!dragAnchor.value) return;
  const spritePx = 200 * size.value; // logical px of sprite diameter
  const dx = (e.clientX - dragAnchor.value.x) / spritePx;
  const dy = (e.clientY - dragAnchor.value.y) / spritePx;
  headOffset.value = {
    x: dragStartOffset.value.x + dx,
    y: dragStartOffset.value.y + dy,
  };
}

function onCalibMouseUp() {
  dragAnchor.value = null;
}

// Global mouse listeners — active only while calibrating.
watch(calibrating, (on) => {
  if (on) {
    window.addEventListener("mousemove", onCalibMouseMove);
    window.addEventListener("mouseup", onCalibMouseUp);
  } else {
    window.removeEventListener("mousemove", onCalibMouseMove);
    window.removeEventListener("mouseup", onCalibMouseUp);
  }
});
const toast = ref("");
let toastTimer: number | undefined;

function showToast(msg: string, ms = 1800) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, ms);
}

function onToggleFollow(v: boolean) {
  followCursor.value = v;
}

function onSleep() {
  menuOpen.value = false;
  showToast("睡觉功能暂未开发");
}

function onFeed() {
  menuOpen.value = false;
  showToast("投喂功能暂未开发");
}

function onQuit() {
  invoke("pet_quit").catch((e) => console.error("pet_quit failed", e));
}

function onMinimize() {
  menuOpen.value = false;
  getCurrentWindow().minimize().catch(() => {});
}

/**
 * Left-button press starts a native OS window drag. Tauri's `startDragging`
 * takes over the gesture: a click-without-move still fires a normal click,
 * while a press-and-move relocates the window. Right-click is reserved for
 * toggling the in-window menu.
 *
 * Double-click is detected manually because `startDragging()` eats the
 * browser's dblclick event — two clicks within 300 ms minimise the window.
 */
let lastClickTime = 0;

async function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  const now = Date.now();
  if (now - lastClickTime < 300) {
    // Double-click → minimize.
    lastClickTime = 0;
    onMinimize();
    return;
  }
  lastClickTime = now;
  try {
    await getCurrentWindow().startDragging();
  } catch {
    // Ignore — window may be tearing down.
  }
}

let timer: number | undefined;

async function tick() {
  if (!followCursor.value) {
    frameIndex.value = 0;
    return;
  }
  try {
    const screen = await invoke<number | null>("pet_cursor_angle");
    if (screen === null) {
      frameIndex.value = 0;
      return;
    }
    const clock = (screen + 90) % 360;
    frameIndex.value = angleToFrame(clock);
  } catch {
    // Ignore transient IPC errors.
  }
}

onMounted(() => {
  // ~20 fps gaze tracking.
  timer = window.setInterval(tick, 50);
  tick();

  // Sync the persisted head offset to Rust on startup.
  if (headOffset.value.x !== 0 || headOffset.value.y !== 0) {
    invoke("pet_set_head_offset", {
      x: headOffset.value.x,
      y: headOffset.value.y,
    }).catch(() => {});
  }

  // The @keydown.esc on the root needs the element to be focusable.
  const root = document.querySelector(".pet") as HTMLElement | null;
  root?.setAttribute("tabindex", "-1");
  root?.focus();
});

onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer);
  if (toastTimer !== undefined) clearTimeout(toastTimer);
});
</script>

<style scoped>
.pet {
  width: 100vw;
  height: 100vh;
  position: relative;
  outline: none;
}

.pet__img-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  -webkit-user-drag: none;
  user-select: none;
}

.pet__img-wrap:active {
  cursor: grabbing;
}

.pet__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

/* Dead-zone circle: shows where the cat is "looking forward". */
.pet__deadzone {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 0, 0, 0.25);
  border: 2px solid rgba(255, 0, 0, 0.5);
  pointer-events: none;
  transform: translate(-50%, -50%);
}

/* Calibration overlay: full-window, blocks interaction with the pet. */
.pet__calib-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.pet__calib-instructions {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 6px 14px;
  border-radius: 12px;
  font-size: 12px;
  font-family: -apple-system, "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  pointer-events: none;
}

.pet__calib-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(0, 200, 80, 0.3);
  border: 2px solid rgba(0, 200, 80, 0.7);
  cursor: move;
  transform: translate(-50%, -50%);
}

.pet__calib-actions {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
}

.pet__toast {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 11px;
  pointer-events: none;
  white-space: nowrap;
  font-family: -apple-system, "Microsoft YaHei", sans-serif;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>

<!-- el-popover renders its popper inside .pet (:teleported="false"), but the
     scoped-style data-attr isn't applied to EP's runtime-created popper, so the
     card-stripping override lives in a plain (unscoped) style block. -->
<style>
.pet-menu-popover.el-popover.el-popper {
  min-width: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
</style>
