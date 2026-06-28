<template>
  <!-- 缺资源引导：透明窗口右下角弹一张卡片，提供「查看设置教程」。 -->
  <div class="missing">
    <div ref="cardEl" class="missing__card">
      <div class="missing__header">
        <div class="missing__title">
          <img class="missing__icon" src="../../../assets/icon.png" alt="cat" />
          还没找到猫咪素材
        </div>
        <div
          class="missing__close"
          role="button"
          tabindex="0"
          aria-label="最小化"
          @mousedown.stop.prevent="onMinimize"
        >
          ×
        </div>
      </div>
      <p class="missing__msg" v-if="message">{{ message }}</p>
      <p class="missing__path" v-if="root">
        当前资源目录：<code>{{ root }}</code>
      </p>
      <div class="missing__btns">
        <el-button type="primary" size="small" @click="openResourceSettings">
          打开设置页面
        </el-button>
        <el-button size="small" @click="$emit('reload')">重新加载</el-button>
        <el-button size="small" type="danger" @click="onQuit">退出</el-button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

defineProps<{
  /** 失败原因说明。 */
  message: string;
  /** 资源根目录绝对路径（提示用户往哪放素材）。 */
  root: string;
}>();

/** 引导卡片元素，用于按其屏幕矩形命中光标。 */
const cardEl = ref<HTMLElement | null>(null);

/**
 * 点击穿透：照搬 `Pet.vue` 的做法，靠 Rust 端轮询「全局光标坐标」来驱动整窗
 * 穿透开关 —— 因为 `pet_cursor_angle` 用的是 OS 级光标位置，**即使窗口已穿透
 * 仍然读得到**，从而能在光标重新移回卡片时把交互切回来（DOM 的 `mouseenter`
 * 在穿透态下收不到事件，会自锁，故不能用）。
 *
 * 命中逻辑：把卡片的视口矩形换算成屏幕物理坐标，判断光标是否落在其中；
 * 落在卡片内 → 整窗可交互（按钮可点），否则 → 整窗穿透（点击落到下层应用）。
 */
let pollTimer: number | undefined;
/** 上一次设置的穿透状态，仅在变化时下发 IPC，避免每个 tick 抖动。 */
let lastIgnore: boolean | null = null;
/** 缓存的窗口左上角（物理像素）与缩放因子——错误态下窗口不动，取一次即可。 */
let winX = 0;
let winY = 0;
let scaleFactor = 1;

/**
 * 每个 tick 只调一个 IPC（`pet_cursor_angle` 取全局光标），其余几何量用挂载时
 * 缓存的窗口位置/缩放因子在本地算，开销与宠物页同档（且频率更低）。
 */
async function poll() {
  const el = cardEl.value;
  if (!el) return;
  try {
    const gaze = await invoke<{ cursor_x: number; cursor_y: number }>(
      "pet_cursor_angle",
    );
    // 卡片相对视口的 CSS 像素矩形 → 屏幕物理坐标（纯本地计算，不走 IPC）。
    const r = el.getBoundingClientRect();
    const left = winX + r.left * scaleFactor;
    const top = winY + r.top * scaleFactor;
    const right = left + r.width * scaleFactor;
    const bottom = top + r.height * scaleFactor;
    const over =
      gaze.cursor_x >= left &&
      gaze.cursor_x <= right &&
      gaze.cursor_y >= top &&
      gaze.cursor_y <= bottom;
    if (lastIgnore !== !over) {
      lastIgnore = !over;
      getCurrentWindow()
        .setIgnoreCursorEvents(!over)
        .catch(() => {});
    }
  } catch {
    // 窗口可能正在销毁——忽略。
  }
}

onMounted(async () => {
  // 挂载时取一次窗口位置与缩放因子并缓存（错误态下不会变化）。
  try {
    const win = getCurrentWindow();
    const [pos, sf] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
    ]);
    winX = pos.x;
    winY = pos.y;
    scaleFactor = sf;
  } catch {
    // 取不到就用默认值，仍能粗略命中。
  }
  pollTimer = window.setInterval(() => void poll(), 80);
});
onUnmounted(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  // 卸载时恢复穿透，后续挂载的 <Pet> 会用自身轮询接管。
  getCurrentWindow()
    .setIgnoreCursorEvents(true)
    .catch(() => {});
});

/** 打开设置窗口并导航到资源设置标签页。 */
async function openResourceSettings() {
  try {
    await invoke("pet_open_settings", { tab: "resources" });
  } catch (e) {
    console.error("打开设置窗口失败：", e);
  }
}

/** 退出应用（与托盘「退出」一致）。 */
function onQuit() {
  invoke("pet_quit").catch(() => {});
}

/** 最小化当前窗口。 */
function onMinimize() {
  getCurrentWindow()
    .minimize()
    .catch(() => {});
}
</script>

<style scoped>
.missing {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 16px;
  box-sizing: border-box;
}

.missing__card {
  width: 280px;
  pointer-events: auto;
  background: rgba(28, 28, 30, 0.92);
  color: #f0f0f0;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 14px 16px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.missing__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.missing__title {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
}

.missing__close {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: #888;
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  user-select: none;
  outline: none;
  flex-shrink: 0;
}

.missing__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.missing__close:active {
  background: rgba(255, 255, 255, 0.15);
}

.missing__icon {
  width: 20px;
  height: 20px;
  margin-right: 8px;
}

.missing__msg {
  font-size: 12px;
  color: #c8c8cc;
  line-height: 1.6;
  margin: 0 0 8px;
}

.missing__msg code {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  color: #ffd479;
  font-family: "Consolas", "Microsoft YaHei", monospace;
}

.missing__detail {
  font-size: 11px;
  color: #8a8a8e;
  line-height: 1.5;
  margin: 0 0 4px;
  word-break: break-all;
}

.missing__path {
  font-size: 11px;
  color: #999;
  margin: 0 0 6px;
  word-break: break-all;
}

.missing__path code {
  color: #4a9eff;
}

.missing__btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.guide {
  font-size: 13px;
  line-height: 1.6;
  color: #333;
}

.guide code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: "Consolas", "Microsoft YaHei", monospace;
}

.guide__code {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  font-family: "Consolas", monospace;
  white-space: pre;
}

.guide__tip {
  color: #666;
  font-size: 12px;
}
</style>
