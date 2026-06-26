<template>
  <div class="pet" @keydown.esc="menuOpen = false" @contextmenu.prevent>
    <!-- 猫咪本体：左键拖动 / 互动，右键打开环形菜单。 -->
    <div class="pet__body">
      <div
        ref="catWrapRef"
        class="pet__img-wrap"
        @contextmenu.prevent="openMenuAt"
      >
        <CatSprite :src="currentSrc" :style="spriteTransform" />
      </div>

      <!-- 猫说话气泡 / 提示气泡：浮在猫头上方，尾巴朝下指向猫。 -->
      <div class="pet__speech">
        <SpeechBubble :show="!!speech" :text="speech" />
        <SpeechBubble :show="updateAvailable" variant="cloud1">
          <div class="pet__update-content">
            <div class="pet__update-text">🔔 发现新版本</div>
            <div class="pet__update-btns">
              <el-button size="small" @click="updateAvailable = false"
                >稍后再说</el-button
              >
              <el-button type="primary" size="small" @click="openUpdatePage()"
                >去更新</el-button
              >
            </div>
          </div>
        </SpeechBubble>
      </div>
    </div>

    <!-- 猫爪菜单：居中浮层覆盖整窗，点任意空白处或窗口失焦时关闭。 -->
    <div
      v-if="menuOpen"
      class="pet__menu-overlay"
      @mousedown="menuOpen = false"
      @contextmenu.prevent.stop="menuOpen = false"
    >
      <Menu
        :style="menuStyle"
        :items="menuSettings"
        :brain="brain"
        v-model:follow="followCursor"
        v-model:passthrough="passthrough"
        v-model:calibrating="calibrating"
        @close="menuOpen = false"
      />
    </div>

    <!-- 校准遮罩层：校准期间覆盖整个窗口，阻止与猫咪本体的交互。 -->
    <div
      v-if="calibrating"
      class="pet__calib-overlay"
      @contextmenu.prevent.stop
    >
      <div
        class="pet__calib-circle"
        :style="calibCircleStyle"
        @mousedown.stop="onCalibMouseDown"
      ></div>
      <!-- 校准提示气泡：锚点与猫咪身体同高同位置，保证 bottom:100% 正好在猫头上方。 -->
      <div class="pet__calib-anchor" :style="calibAnchorStyle">
        <div class="pet__speech">
          <SpeechBubble :show="true" variant="cloud1">
            <div class="pet__calib-content">
              <div class="pet__calib-text">拖动圆圈对准猫头</div>
              <div class="pet__calib-btns">
                <el-button type="primary" size="small" @click="confirmCalibrate"
                  >确认</el-button
                >
                <el-button size="small" @click="cancelCalibrate"
                  >取消</el-button
                >
              </div>
            </div>
          </SpeechBubble>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import Menu, { MENU_WIDTH, MENU_HEIGHT } from "../Menu/Menu.vue";
import CatSprite from "../CatSprite/CatSprite.vue";
import SpeechBubble from "../SpeechBubble/SpeechBubble.vue";
import {
  size,
  opacity,
  alwaysOnTop,
  passthrough,
} from "../../composables/useDisplaySettings";
import { menuSettings } from "../../composables/useMenuSettings";
import { useCatBrain } from "../../composables/useCatBrain";
import { PET_ACTIONS, type PetActionContext } from "../../composables/usePetActions";
import { useGestures } from "../../composables/useGestures";
import { actionOfFrame, transformOfAction } from "../../actions/clips";
import {
  triggerBindings,
  TRIGGER_BINDINGS_CHANGED_EVENT,
  TRIGGER_BINDINGS_RESULT_EVENT,
  loadTriggerBindings,
  matchesKey,
  toAccelerator,
  type TriggerBinding,
  type TriggerResult,
} from "../../composables/useTriggerBindings";

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

/** 猫咪本体包裹层，供手势引擎绑定事件。 */
const catWrapRef = ref<HTMLElement | undefined>();

const ctrlPressed = ref(false);

/** 菜单贴窗口边时保留的安全边距，避免视觉上紧贴边缘。 */
const MENU_EDGE_PADDING = 4;

/**
 * 菜单左上角在窗口内的像素位置：右键时按光标位置放置，再 clamp 到窗口内，
 * 使菜单永远完整可见（贴边自动回收，类似 el-popper 的 shift 中间件）。
 * 宽高从 Menu.vue 导出，与 viewBox 裁剪后的实际内容一致。
 */
const menuPos = ref({ x: 0, y: 0 });

/** 手势引擎在触发动作前写入的指针位置，供 openMenu 等动作使用。 */
const pendingMenuPos = ref<{ x: number; y: number } | undefined>();

/**
 * 把菜单"中心点"放到 `(cx, cy)` 处，再 clamp 到窗口内。
 * 鼠标右键时 cx/cy = 光标位置；非鼠标触发（如托盘）时传 `undefined` → 落在窗口中心。
 */
function placeMenuAt(cx?: number, cy?: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const halfW = MENU_WIDTH / 2;
  const halfH = MENU_HEIGHT / 2;
  const minX = MENU_EDGE_PADDING;
  const minY = MENU_EDGE_PADDING;
  const maxX = Math.max(minX, W - MENU_WIDTH - MENU_EDGE_PADDING);
  const maxY = Math.max(minY, H - MENU_HEIGHT - MENU_EDGE_PADDING);
  const targetX = (cx ?? W / 2) - halfW;
  const targetY = (cy ?? H / 2) - halfH;
  menuPos.value = {
    x: Math.min(Math.max(targetX, minX), maxX),
    y: Math.min(Math.max(targetY, minY), maxY),
  };
  menuOpen.value = true;
}

/** 右键打开菜单：以光标位置为中心，贴边自动回收。 */
function openMenuAt(e: MouseEvent) {
  placeMenuAt(e.clientX, e.clientY);
}

/** 菜单浮层定位样式：左上角即为 `menuPos`，宽高交给 Menu 自身。 */
const menuStyle = computed(() => ({
  position: "absolute" as const,
  left: `${menuPos.value.x}px`,
  top: `${menuPos.value.y}px`,
}));

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
  const px = Math.round(200 * size.value);
  return {
    width: `${px}px`,
    height: `${px}px`,
    opacity: `${opacity.value}`,
    transform: `translate(${tx}px, ${ty}px) scale(${t.scale})`,
    transformOrigin: "bottom center",
  };
});

// 校准圆圈：与死区大小相同，使用绿色，可拖动。
// 精灵图横向居中、纵向贴窗口底（窗口顶部预留气泡余量），因此头部原点：
// 横向 = 窗口中心（left 50%），纵向 = 窗口底向上 sprite_px/2，再加校准偏移。
// 这必须与 Rust 端 `pet_cursor_angle` 的头部中心计算保持一致，
// 否则校准偏移量会被按错误的原点解释，导致注视死区落在错误的位置。
const calibCircleStyle = computed(() => {
  const sprite = 200 * size.value;
  const d = Math.round(sprite * 0.1225);
  const ox = Math.round(sprite * headOffset.value.x);
  const oy = Math.round(sprite * headOffset.value.y);
  return {
    width: `${d}px`,
    height: `${d}px`,
    left: `calc(50% + ${ox}px)`,
    // 100% = .pet__calib-overlay 高 = 窗口高；底向上半个精灵直径 = 猫的纵向中心。
    top: `calc(100% - ${sprite / 2}px + ${oy}px)`,
  };
});

/**
 * 校准提示气泡的锚点：与猫咪身体同宽、同高、同位置。
 * 将气泡放进这个锚点后，bottom:100% 就会正好落在猫头上方，
 * 与 .pet__body 里的普通/更新气泡保持一致的定位约定。
 */
const calibAnchorStyle = computed(() => {
  const h = Math.round(200 * size.value);
  return {
    position: "absolute" as const,
    left: "50%",
    bottom: "0",
    width: `${h}px`,
    height: `${h}px`,
    transform: "translateX(-50%)",
    pointerEvents: "none" as const,
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
// size / opacity / passthrough 由 useDisplaySettings composable 统一持久化和跨窗口同步。
watch(followCursor, (v) => localStorage.setItem("pet-follow", String(v)));

// 窗口层级：监听 composable 中 alwaysOnTop 的变化，调 Tauri API 实际应用到主窗口。
watch(
  alwaysOnTop,
  (on) => {
    getCurrentWindow()
      .setAlwaysOnTop(on)
      .catch(() => {
        // 忽略——窗口可能正在销毁。
      });
  },
  { immediate: true },
);

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

// ── 手势配置 ─────────────────────────────────────────────────────
// 单击 / 双击 / 右键 / 长按对应哪个动作由 gestureConfig 决定；
// 拖动固定走 Tauri 原生窗口拖动，不参与配置。
/** 动作执行上下文；手势与快捷键共用同一份。 */
const petCtx: PetActionContext = {
  brain,
  menuOpen,
  calibrating,
  followCursor,
  passthrough,
  say,
  placeMenuAt,
  pendingMenuPos,
};

useGestures(catWrapRef, triggerBindings, PET_ACTIONS, petCtx);

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
// 注意：`updateAvailable` 必须在此 computed 之前声明——下方
// `watch(interactive, …, { immediate: true })` 会同步求值，若声明
// 在其后会触发 TDZ（Cannot access before initialization）。
/** 是否检测到新版本（控制轻提示气泡显示）。 */
const updateAvailable = ref(false);

/** 窗口是否应响应鼠标事件（非穿透）。 */
const interactive = computed(() => {
  // 菜单 / 校准 / 更新提示期间，窗口必须可交互，否则按钮点不到。
  if (menuOpen.value || calibrating.value || updateAvailable.value) return true;
  if (passthrough.value && !ctrlPressed.value) return false;
  return brain.cursorOverCat.value;
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
// `updateAvailable` 已在上方「点击穿透」块声明（供 `interactive` computed 引用）。

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

// ── 云朵气泡（猫说话 / 轻提示共用） ────────────────────────────────
// 所有需要给用户看的短消息（戳猫台词、校准完成、穿透切换等）都走同一朵云，
// 不再另写 toast 提示。新版本提示用独立的云朵实例（见模板）。
/** 当前气泡文字；为空时不显示。 */
const speech = ref("");
let speechTimer: number | undefined;

/** 让猫说一句话（或显示一条轻提示），停留 ms 毫秒后消失。 */
function say(msg: string, ms = 3000) {
  speech.value = msg;
  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = window.setTimeout(() => {
    speech.value = "";
  }, ms);
}

/**
 * 轻提示：复用猫说话的云朵气泡显示一条短消息。
 * 与 `say` 同一朵云，避免再单独维护一套 toast 机制。
 */
function showToast(msg: string, ms = 1800) {
  say(msg, ms);
}

// ── 快捷键 ───────────────────────────────────────────────────────
// 全局键经 global-shortcut 插件在系统层注册，任何程序活跃时都触发；
// 应用内键仅在主窗口聚焦时由 keydown 捕获。两类按键的动作统一走 PET_ACTIONS，
// 与手势共用 petCtx，不再维护独立的 shortcutActions 映射。

/** 当前生效的应用内快捷键：按键串 → TriggerBinding。每次应用时重建。 */
let appKeyMap: Record<string, TriggerBinding> = {};

/**
 * 按 entry 的 actionId 分发动作；统一走 PET_ACTIONS，与手势共用 petCtx。
 * 对 togglePassthrough 补一次 toast，保持与迁移前独立实现一致。
 */
function dispatchKeyBinding(entry: TriggerBinding): void {
  const action = PET_ACTIONS[entry.actionId] ?? PET_ACTIONS.none;
  action(petCtx);
  if (entry.actionId === "togglePassthrough") {
    showToast(passthrough.value ? "已开启穿透" : "已关闭穿透");
  }
}

/**
 * 按最新配置（重新）应用全部快捷键：
 * 1) 注销此前注册的全部全局键；
 * 2) 逐条注册全局键，注册失败（多半被其他程序占用）记入 failedIds；
 * 3) 重建应用内键查找表，交由窗口 keydown 监听匹配；
 * 4) 把 failedIds 回传给设置窗，用于标红提示。
 * 手势侧由 useGestures 直接读 triggerBindings，无需在此处理。
 */
async function applyTriggerBindings() {
  // 全局键：先清空我们注册过的全部全局键，再逐条注册。
  try {
    await unregisterAll();
  } catch {
    // 忽略——可能此前未注册过任何全局键。
  }

  const failedIds: string[] = [];
  appKeyMap = {};

  for (const entry of triggerBindings.value) {
    if (entry.kind !== "key" || !entry.trigger) continue;
    if (entry.isGlobal) {
      try {
        // 注册时绑定回调；按下（而非松开）时触发一次。
        await register(toAccelerator(entry.trigger), (e) => {
          if (e.state === "Pressed") dispatchKeyBinding(entry);
        });
      } catch {
        // 注册失败＝该组合键已被其他程序占用，系统层无法抢占，记下供前端提示。
        failedIds.push(entry.id);
      }
    } else {
      appKeyMap[entry.trigger] = entry;
    }
  }

  // 回传注册结果给设置窗（若其打开着），用于标记被占用的全局键。
  emit(TRIGGER_BINDINGS_RESULT_EVENT, { failedIds } as TriggerResult).catch(() => {});
}

/** 窗口级 keydown：匹配应用内快捷键。仅主窗口聚焦时触发，故不与其他软件全局冲突。 */
function onAppShortcutKeydown(e: KeyboardEvent) {
  for (const key in appKeyMap) {
    if (matchesKey(e, key)) {
      e.preventDefault();
      dispatchKeyBinding(appKeyMap[key]);
      return;
    }
  }
}

let unlistenOpenMenu: UnlistenFn | undefined;
let unlistenShortcuts: UnlistenFn | undefined;
let unlistenFocus: UnlistenFn | undefined;

onMounted(async () => {
  // 启动时将已持久化的头部偏移量同步给 Rust。
  if (headOffset.value.x !== 0 || headOffset.value.y !== 0) {
    invoke("pet_set_head_offset", {
      x: headOffset.value.x,
      y: headOffset.value.y,
    }).catch(() => {});
  }

  // 监听托盘"设置"菜单项：显示窗口并打开菜单面板（隐身模式下也能操作）。
  // 没有鼠标事件可参考，菜单落在窗口中心。
  try {
    unlistenOpenMenu = await listen("pet-open-menu", () => {
      placeMenuAt();
    });
  } catch {
    // 忽略——事件绑定不可用。
  }

  // 根元素上的 @keydown.esc 需要该元素可获得焦点。
  const root = document.querySelector(".pet") as HTMLElement | null;
  root?.setAttribute("tabindex", "-1");
  root?.focus();

  // 应用内快捷键：注册全局键 + 启用应用内 keydown 匹配。
  window.addEventListener("keydown", onAppShortcutKeydown);
  applyTriggerBindings();

  // 窗口失去焦点时自动关闭菜单（覆盖"点击应用外"的场景）。
  getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (!focused) menuOpen.value = false;
    })
    .then((fn) => {
      unlistenFocus = fn;
    });
  // 设置窗保存快捷键后会广播该事件，主窗收到即重新应用。
  try {
    unlistenShortcuts = await listen(TRIGGER_BINDINGS_CHANGED_EVENT, () => {
      // 设置窗保存后广播新绑定；主窗刷新本地 ref 并重新应用。
      triggerBindings.value = loadTriggerBindings();
      applyTriggerBindings();
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
  unlistenFocus?.();
  window.removeEventListener("keydown", onAppShortcutKeydown);
  // 注销本窗口注册的全部全局键，避免热重载重挂后重复注册。
  unregisterAll().catch(() => {});
  if (ctrlPollTimer !== undefined) window.clearInterval(ctrlPollTimer);
  if (speechTimer !== undefined) window.clearTimeout(speechTimer);
});
</script>

<style scoped lang="scss">
.pet {
  width: 100vw;
  height: 100vh;
  display: flex;
  // 横向居中、纵向贴窗口底：窗口顶部预留 BUBBLE_HEADROOM_PX 给气泡向上展开，
  // 不会再因猫放大到 PET_MAX_SCALE 时把气泡顶出窗口。需与 Rust 端
  // `geometry::clamp_to_work_area` 和 `gaze::pet_cursor_angle` 的"贴底"约定一致。
  align-items: flex-end;
  justify-content: center;
  position: relative;
  outline: none;

  .pet__body {
    position: relative;

    .pet__img-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      -webkit-user-drag: none;
      user-select: none;
      pointer-events: auto;

      &:active {
        cursor: grabbing;
      }
    }
  }
}

/* 猫说话 / 提示气泡的通用定位：浮在锚点（.pet__body 或 .pet__calib-anchor）上方。 */
.pet__speech {
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  z-index: 40;
  width: 300%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
}

/* 环形菜单浮层：覆盖整个窗口，菜单在其中居中。空白处点击关闭。 */
.pet__menu-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  pointer-events: auto;
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

.pet__calib-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(0, 200, 80, 0.3);
  border: 2px solid rgba(0, 200, 80, 0.7);
  cursor: move;
  transform: translate(-50%, -50%);
}

/* 校准遮罩层：覆盖整个窗口，阻止点击穿透到猫咪本体。 */
.pet__calib-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: auto;
}

/* 校准提示气泡的锚点：与猫咪身体重合，保证气泡相对猫定位。 */
.pet__calib-anchor {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
}

/* 新版本提示气泡的内容布局。 */
.pet__update-content {
  padding: 0 10px 20px;
  text-align: center;
}

.pet__update-text {
  font-size: 13px;
  margin-bottom: 8px;
}

.pet__update-btns {
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* 校准提示气泡的内容布局。 */
.pet__calib-content {
  padding: 0 10px 16px;
  text-align: center;
}

.pet__calib-text {
  font-size: 13px;
  margin-bottom: 8px;
  white-space: nowrap;
}

.pet__calib-btns {
  display: flex;
  gap: 8px;
  justify-content: center;
}
</style>
