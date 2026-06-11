<template>
  <div class="pet" @keydown.esc="menuOpen = false" @contextmenu.prevent>
    <!-- Right-click the cat to open the menu. The window is always wide
         enough to hold the cat (right-aligned) + the menu panel (left side),
         so placement="left-end" works without needing a dynamic resize.
         :teleported="false" keeps the panel inside the window. -->
    <el-popover
      v-model:visible="menuOpen"
      trigger="contextmenu"
      placement="left-end"
      :width="200"
      :teleported="false"
      :show-arrow="false"
      :persistent="false"
      :popper-options="{ modifiers: [{ name: 'flip', enabled: false }] }"
      popper-class="pet-menu-popover"
    >
      <template #reference>
        <div
          class="pet__img-wrap"
          :style="imgStyle"
          @mousedown="onMouseDown"
          @contextmenu.prevent
        >
          <CatSprite :src="currentSrc" />
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
import { computed, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Menu from "../Menu/Menu.vue";
import CatSprite from "../CatSprite/CatSprite.vue";
import { useCatBrain } from "../../composables/useCatBrain";

// ── Behaviour state machine ──────────────────────────────────────────
// All "which frame to show" logic lives in the brain; Pet.vue only owns
// window-level concerns (drag, menu, calibration, toast, sizing).
/** When false, the cat ignores the cursor (the "别偷看" toggle). */
const followCursor = ref(true);
const brain = useCatBrain({ followEnabled: () => followCursor.value });
const currentSrc = brain.currentSrc;

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

/** In-window menu state. */
const menuOpen = ref(false);

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

// ── Toast ────────────────────────────────────────────────────────────
const toast = ref("");
let toastTimer: number | undefined;

function showToast(msg: string, ms = 1800) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, ms);
}

// ── Menu actions ─────────────────────────────────────────────────────
function onToggleFollow(v: boolean) {
  followCursor.value = v;
}

function onSleep() {
  menuOpen.value = false;
  brain.trigger("sleep", "follow");
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

onMounted(() => {
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
</script>

<style scoped>
.pet {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
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
  pointer-events: auto;
}

.pet__img-wrap:active {
  cursor: grabbing;
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
  pointer-events: auto;
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
  pointer-events: auto;
}
</style>
