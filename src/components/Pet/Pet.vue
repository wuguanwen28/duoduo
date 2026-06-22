<template>
  <div class="pet" @keydown.esc="menuOpen = false" @contextmenu.prevent>
    <!-- 右键点击猫咪即可打开菜单。窗口始终足够宽，能同时容纳猫咪（右对齐）
         和菜单面板（左侧），因此 placement="left-end" 无需动态调整窗口尺寸即可正常工作。
         :teleported="false" 使面板保持在窗口内部。 -->
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
          <CatSprite :src="currentSrc" :style="spriteTransform" />
        </div>
      </template>
      <Menu
        :size="size"
        :opacity="opacity"
        :follow="followCursor"
        :passthrough="passthrough"
        @update:size="size = $event"
        @update:opacity="opacity = $event"
        @update:follow="onToggleFollow"
        @update:passthrough="passthrough = $event"
        @calibrate="startCalibrate"
        @boss="onMinimize"
        @close="menuOpen = false"
        @quit="onQuit"
        @sleep="onSleep"
        @feed="onFeed"
      />
    </el-popover>

    <!-- 校准遮罩层：校准期间覆盖整个窗口。 -->
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

    <!-- 发现新版本：右上角轻提示，点开跳设置「关于/更新」。
         穿透开启时窗口整体不响应鼠标事件，气泡不可点；此时改为引导用户从托盘进设置。 -->
    <div
      v-if="updateAvailable"
      class="pet-update-badge"
      :title="badgeClickable ? '发现新版本，点击查看' : '发现新版本，请从托盘→设置查看'"
      @click="badgeClickable && openUpdatePage()"
    >
      {{ badgeClickable ? "🔔 新版本" : "🔔 新版本（托盘→设置查看）" }}
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  register,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";
import Menu from "../Menu/Menu.vue";
import CatSprite from "../CatSprite/CatSprite.vue";
import { useCatBrain } from "../../composables/useCatBrain";
import { actionOfFrame, transformOfAction } from "../../actions/clips";
import {
  SHORTCUT_DEFS,
  SHORTCUTS_CHANGED_EVENT,
  SHORTCUTS_RESULT_EVENT,
  loadShortcutMap,
  matchesKey,
  toAccelerator,
  type ShortcutResult,
} from "../../composables/useShortcuts";

// ── 行为状态机 ──────────────────────────────────────────
// 所有"显示哪一帧"的逻辑都集中在 brain 中；Pet.vue 只负责
// 窗口层面的事务（拖动、菜单、校准、提示、尺寸缩放）。
/** 从 localStorage 读数字/布尔设置；缺失或非法时用默认值。用于热重载（重挂）后恢复用户设置。 */
function loadSetting<T extends number | boolean>(key: string, def: T): T {
  const raw = localStorage.getItem(key);
  if (raw === null) return def;
  if (typeof def === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : def) as T;
  }
  return (raw === "true") as T;
}

/** 为 false 时，猫咪会忽略光标（即"别偷看"开关）。 */
const followCursor = ref(loadSetting<boolean>("pet-follow", true));
const brain = useCatBrain({
  followEnabled: () => followCursor.value,
  // 校准期间让猫咪停留在 idle 状态，使其头部停止跟踪光标
  //（因为校准圆圈是随鼠标拖动的）。`calibrating` 在下方声明；
  // 该 getter 只会在之后的 brain tick 中被调用。
  paused: () => calibrating.value,
});
const currentSrc = brain.currentSrc;

const size = ref(loadSetting<number>("pet-size", 0.5));
const opacity = ref(loadSetting<number>("pet-opacity", 0.5));
/** 穿透点击：开启后鼠标事件穿透到下层窗口，按住 Ctrl 时临时恢复交互。 */
const passthrough = ref(loadSetting<boolean>("pet-passthrough", true));
const ctrlPressed = ref(false);
const imgStyle = computed(() => {
  const px = Math.round(200 * size.value);
  return {
    width: `${px}px`,
    height: `${px}px`,
    opacity: `${opacity.value}`,
  };
});

// 按当前帧所属来源做视觉对齐：不同文件夹素材里猫的位置/大小不一致，
// 这里把该来源的偏移/缩放（见 clips.ts 的 SOURCE_TRANSFORMS）应用到精灵图上。
// 偏移以精灵直径(200*size)为基准换算成像素，故缩放滑块拉动时相对位置不变；
// 缩放以底部中心为锚（猫脚不动、向上伸缩）。变换只作用在 <img> 视觉层，
// 不影响外层 wrap 的点击命中、菜单锚点与 Rust 注视计算。
const spriteTransform = computed(() => {
  const t = transformOfAction(actionOfFrame(currentSrc.value));
  const base = 200 * size.value;
  const tx = Math.round(base * t.offsetX);
  const ty = Math.round(base * t.offsetY);
  return {
    transform: `translate(${tx}px, ${ty}px) scale(${t.scale})`,
    transformOrigin: "bottom center",
  };
});

// 校准圆圈：与死区大小相同，使用绿色，可拖动。
// 精灵图在窗口中右下对齐（菜单预留区域位于左侧），因此头部原点是
// 精灵图中心——即从左上角算起的 `100% - half`——而非窗口中心。
// 这必须与 `pet_cursor_angle` 中 Rust 端的头部中心计算保持一致，
// 否则校准偏移量会被按错误的原点解释，导致注视死区落在错误的位置。
const calibCircleStyle = computed(() => {
  const d = Math.round(200 * size.value * 0.1225);
  const half = Math.round(200 * size.value * 0.5); // 精灵图半径（像素）
  const ox = Math.round(200 * size.value * headOffset.value.x);
  const oy = Math.round(200 * size.value * headOffset.value.y);
  return {
    width: `${d}px`,
    height: `${d}px`,
    left: `calc(100% - ${half - ox}px)`,
    top: `calc(100% - ${half - oy}px)`,
  };
});

// 将精灵图缩放比例同步给 Rust，使其屏幕边界约束的是实际的猫咪内容
//（在超大窗口中居中），而非窗口边框。立即执行一次，
// 以便后端从一开始就使用正确的缩放比例。
watch(
  size,
  (s) => {
    invoke("pet_set_content_scale", { scale: s }).catch(() => {
      // 忽略——销毁过程中后端可能尚未就绪。
    });
  },
  { immediate: true },
);

// 持久化用户设置：热重载重挂 <Pet> 后自动恢复（headOffset 另有持久化）。
watch(size, (v) => localStorage.setItem("pet-size", String(v)));
watch(opacity, (v) => localStorage.setItem("pet-opacity", String(v)));
watch(passthrough, (v) => localStorage.setItem("pet-passthrough", String(v)));
watch(followCursor, (v) => localStorage.setItem("pet-follow", String(v)));

/** 窗口内菜单的状态。 */
const menuOpen = ref(false);

// ── 头部校准 ─────────────────────────────────────────────────
// 头部偏移量相对于精灵图*直径*的比例，使其在尺寸变化时保持稳定。
//（0,0）= 图像中心，（0,-0.2）= 略微偏上。
const calibrating = ref(false);
const headOffset = ref<{ x: number; y: number }>({ x: 0, y: 0 });

// 启动时加载已持久化的偏移量。
try {
  const raw = localStorage.getItem("pet-head-offset");
  if (raw) {
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      headOffset.value = parsed;
    }
  }
} catch {
  /* 数据损坏——忽略 */
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

// ── 拖动处理（校准模式） ─────────────────────────────────
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
  const spritePx = 200 * size.value; // 精灵图直径的逻辑像素值
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

// 全局鼠标监听器——仅在校准期间激活。
watch(calibrating, (on) => {
  if (on) {
    window.addEventListener("mousemove", onCalibMouseMove);
    window.addEventListener("mouseup", onCalibMouseUp);
  } else {
    window.removeEventListener("mousemove", onCalibMouseMove);
    window.removeEventListener("mouseup", onCalibMouseUp);
  }
});

// ── 点击穿透 ─────────────────────────────────────────────────────
// 窗口大部分区域是透明的；只有猫咪（以及打开时的菜单/校准界面）
// 应当响应点击——其余区域的点击都穿透到后方的应用。
// `setIgnoreCursorEvents` 作用于整个窗口。穿透点击开启后直接穿透，
// 但按住 Ctrl 时临时恢复交互，方便重新打开菜单或拖动猫咪。
// 仅在状态变化时切换，以避免每个 tick 都产生 IPC 抖动。
/** 窗口是否应响应鼠标事件（非穿透）。 */
const interactive = computed(() => {
  if (menuOpen.value || calibrating.value) return true;
  if (passthrough.value && !ctrlPressed.value) return false;
  return brain.cursorOverCat.value;
});

/**
 * 新版本提示气泡当前是否可点击：
 * - 关闭穿透时整窗交互，气泡可直接点击；
 * - 开启穿透时整窗不响应鼠标，气泡靠按住 Ctrl 临时恢复交互即可点；
 * - 否则只显示文案，引导用户从托盘进入设置。
 */
const badgeClickable = computed(() => {
  return !passthrough.value || ctrlPressed.value;
});
watch(
  interactive,
  (on) => {
    getCurrentWindow()
      .setIgnoreCursorEvents(!on)
      .catch(() => {
        // 忽略——窗口可能正在销毁。
      });
  },
  { immediate: true },
);

let ctrlPollTimer: number | undefined;

async function pollCtrlPressed() {
  try {
    ctrlPressed.value = await invoke<boolean>("pet_ctrl_pressed");
  } catch {
    ctrlPressed.value = false;
  }
}

watch(
  passthrough,
  (on) => {
    if (ctrlPollTimer !== undefined) {
      window.clearInterval(ctrlPollTimer);
      ctrlPollTimer = undefined;
    }
    ctrlPressed.value = false;
    if (on) {
      void pollCtrlPressed();
      // 穿透状态下窗口可能收不到键盘事件，所以主动轮询 Ctrl 状态。
      ctrlPollTimer = window.setInterval(() => void pollCtrlPressed(), 80);
    }
  },
  { immediate: true },
);

// ── 更新检查 ─────────────────────────────────────────────────────
/** 是否检测到新版本（控制轻提示气泡显示）。 */
const updateAvailable = ref(false);

/** 启动后台静默检查更新；失败完全忽略（不打扰用户）。 */
async function silentCheckUpdate() {
  try {
    const r = await invoke<{ hasUpdate: boolean }>("pet_update_check");
    updateAvailable.value = r.hasUpdate;
  } catch {
    // 静默：网络不可达 / 无源时不提示。
  }
}

/** 点击提示气泡：打开设置窗口的「关于/更新」页。 */
function openUpdatePage() {
  updateAvailable.value = false;
  invoke("pet_open_settings", { tab: "update" }).catch(() => {});
}

// ── 提示 ────────────────────────────────────────────────────────────
const toast = ref("");
let toastTimer: number | undefined;

function showToast(msg: string, ms = 1800) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, ms);
}

// ── 菜单操作 ─────────────────────────────────────────────────────
function onToggleFollow(v: boolean) {
  followCursor.value = v;
}

function onSleep() {
  menuOpen.value = false;
  brain.trigger("sleep");
}

function onFeed() {
  menuOpen.value = false;
  // 投喂＝切到 idle 并播一次 feed。
  brain.trigger("feed");
}

function onQuit() {
  invoke("pet_quit").catch((e) => console.error("pet_quit failed", e));
}

function onMinimize() {
  menuOpen.value = false;
  getCurrentWindow().minimize().catch(() => {});
}

/**
 * 左键手势统一区分点击、拖动与双击：干净点击交给大脑处理，
 * 移动超过阈值才交由 Tauri 原生拖动接管；双击需手动检测，
 * 因为 `startDragging()` 会吞掉浏览器的 dblclick 事件。
 */
let lastClickTime = 0;

/** 达到该移动像素数即视为拖动。 */
const ACTION_DRAG_THRESHOLD = 5;

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;

  const start = { x: e.clientX, y: e.clientY };
  let dragging = false;

  function cleanup() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }

  function onMove(ev: MouseEvent) {
    if (dragging) return;
    if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > ACTION_DRAG_THRESHOLD) {
      dragging = true;
      cleanup();
      getCurrentWindow().startDragging().catch(() => {});
    }
  }

  function onUp() {
    cleanup();
    if (dragging) return;

    if (brain.canWake()) {
      brain.wake();
      return;
    }

    const now = Date.now();
    if (now - lastClickTime < 300) {
      lastClickTime = 0;
      onMinimize();
      return;
    }
    lastClickTime = now;
    brain.poke();
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// ── 快捷键 ───────────────────────────────────────────────────────
// 全局键（如「老板来了」）经 global-shortcut 插件在系统层注册，任何程序活跃时都触发；
// 应用内键仅在主窗口聚焦时由 keydown 捕获。两类按键的动作集中在此分发。
/** id → 动作。全局与应用内共用同一套动作实现。 */
const shortcutActions: Record<string, () => void> = {
  "open-settings": () => {
    invoke("pet_open_settings").catch(() => {});
  },
  "boss-coming": () => {
    invoke("pet_toggle_visibility").catch(() => {});
  },
  "toggle-passthrough": () => {
    passthrough.value = !passthrough.value;
    showToast(passthrough.value ? "已开启穿透" : "已关闭穿透");
  },
};

/** 当前生效的应用内快捷键：按键串 → 动作 id。每次应用时重建。 */
let appShortcutMap: Record<string, string> = {};

/**
 * 按最新配置（重新）应用全部快捷键：
 * 1) 注销此前注册的全部全局键；
 * 2) 逐条注册全局键，注册失败（多半被其他程序占用）记入 failedIds；
 * 3) 重建应用内键查找表，交由窗口 keydown 监听匹配；
 * 4) 把 failedIds 回传给设置窗，用于标红提示。
 */
async function applyShortcuts() {
  const map = loadShortcutMap();

  // 全局键：先清空我们注册过的全部全局键，再逐条注册。
  try {
    await unregisterAll();
  } catch {
    // 忽略——可能此前未注册过任何全局键。
  }

  const failedIds: string[] = [];
  appShortcutMap = {};

  for (const def of SHORTCUT_DEFS) {
    const key = map[def.id];
    if (!key) continue;
    if (def.scope === "global") {
      try {
        // 注册时绑定回调；按下（而非松开）时触发一次。
        await register(toAccelerator(key), (e) => {
          if (e.state === "Pressed") shortcutActions[def.id]?.();
        });
      } catch {
        // 注册失败＝该组合键已被其他程序占用，系统层无法抢占，记下供前端提示。
        failedIds.push(def.id);
      }
    } else {
      appShortcutMap[key] = def.id;
    }
  }

  // 回传注册结果给设置窗（若其打开着），用于标记被占用的全局键。
  emit(SHORTCUTS_RESULT_EVENT, { failedIds } as ShortcutResult).catch(() => {});
}

/** 窗口级 keydown：匹配应用内快捷键。仅主窗口聚焦时触发，故不与其他软件全局冲突。 */
function onAppShortcutKeydown(e: KeyboardEvent) {
  for (const key in appShortcutMap) {
    if (matchesKey(e, key)) {
      e.preventDefault();
      shortcutActions[appShortcutMap[key]]?.();
      return;
    }
  }
}

let unlistenOpenMenu: UnlistenFn | undefined;
let unlistenShortcuts: UnlistenFn | undefined;

onMounted(async () => {
  // 启动时将已持久化的头部偏移量同步给 Rust。
  if (headOffset.value.x !== 0 || headOffset.value.y !== 0) {
    invoke("pet_set_head_offset", {
      x: headOffset.value.x,
      y: headOffset.value.y,
    }).catch(() => {});
  }

  // 监听托盘"设置"菜单项：显示窗口并打开菜单面板（隐身模式下也能操作）。
  try {
    unlistenOpenMenu = await listen("pet-open-menu", () => {
      menuOpen.value = true;
    });
  } catch {
    // 忽略——事件绑定不可用。
  }

  // 根元素上的 @keydown.esc 需要该元素可获得焦点。
  const root = document.querySelector(".pet") as HTMLElement | null;
  root?.setAttribute("tabindex", "-1");
  root?.focus();

  // 应用快捷键：注册全局键 + 启用应用内 keydown 匹配。
  window.addEventListener("keydown", onAppShortcutKeydown);
  applyShortcuts();
  // 设置窗保存快捷键后会广播该事件，主窗收到即重新应用。
  try {
    unlistenShortcuts = await listen(SHORTCUTS_CHANGED_EVENT, () => {
      applyShortcuts();
    });
  } catch {
    // 忽略——事件绑定不可用。
  }

  // 启动后静默检查更新；失败不打扰用户。
  silentCheckUpdate();
});

onUnmounted(() => {
  unlistenOpenMenu?.();
  unlistenShortcuts?.();
  window.removeEventListener("keydown", onAppShortcutKeydown);
  // 注销本窗口注册的全部全局键，避免热重载重挂后重复注册。
  unregisterAll().catch(() => {});
  if (ctrlPollTimer !== undefined) window.clearInterval(ctrlPollTimer);
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

/* 死区圆圈：标示猫咪"正视前方"的区域。 */
.pet__deadzone {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 0, 0, 0.25);
  border: 2px solid rgba(255, 0, 0, 0.5);
  pointer-events: none;
  transform: translate(-50%, -50%);
}

/* 校准遮罩层：覆盖整个窗口，阻止与宠物的交互。 */
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
</style>

<!-- el-popover 将其 popper 渲染在 .pet 内部（:teleported="false"），但
     scoped 样式的 data 属性不会应用到 EP 运行时创建的 popper 上，因此
     用于剥离卡片样式的覆盖规则放在了一个普通（非 scoped）的 style 块中。 -->
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
