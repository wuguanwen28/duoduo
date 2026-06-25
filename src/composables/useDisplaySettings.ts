/**
 * 显示设置 —— 大小、透明度、窗口层级。
 *
 * 全部存在 localStorage，key 前缀 `pet-display-`。
 * 【单向同步模式】：只有设置窗会调用 `saveAndBroadcast()` 广播；
 * 主窗只监听事件更新本地状态，永远不广播，避免死循环。
 */
import { ref } from "vue";
import { listen, emit } from "@tauri-apps/api/event";

/** 跨窗口同步事件名。 */
export const DISPLAY_SETTINGS_CHANGED_EVENT = "display-settings-changed";

/** 显示设置结构。 */
export interface DisplaySettings {
  size: number;
  opacity: number;
  alwaysOnTop: boolean;
}

/**
 * 广播 payload 在 DisplaySettings 基础上多带一个源窗口标识，
 * 用来在 listen 里识别并过滤"自己 emit、自己收到"的回声。
 */
interface DisplaySettingsPayload extends DisplaySettings {
  /** 发出该事件的会话实例 ID。 */
  _src: string;
}

/** 本次会话（本窗口本次加载）的唯一标识，模块加载时生成一次，永不变。 */
const SOURCE_ID = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2)}`;

/** 广播节流间隔（毫秒）：滑块 ~60Hz 抖动太多，合并到 ~20Hz 即可。 */
const BROADCAST_THROTTLE_MS = 50;

const DEFAULTS: DisplaySettings = {
  size: 0.5,
  opacity: 1,
  alwaysOnTop: true,
};

/** 从 localStorage 读取数字/布尔值；缺失或非法时回退到默认值。 */
function loadNumber(key: string, def: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function loadBool(key: string, def: boolean): boolean {
  const raw = localStorage.getItem(key);
  return raw === null ? def : raw === "true";
}

export const size = ref(loadNumber("pet-display-size", DEFAULTS.size));
export const opacity = ref(loadNumber("pet-display-opacity", DEFAULTS.opacity));
export const alwaysOnTop = ref(
  loadBool("pet-display-alwaysOnTop", DEFAULTS.alwaysOnTop),
);

/** 将当前显示设置序列化为对象。 */
function snapshot(): DisplaySettings {
  return {
    size: size.value,
    opacity: opacity.value,
    alwaysOnTop: alwaysOnTop.value,
  };
}

/** 浮点数比较：用 epsilon 避免精度问题导致的死循环。 */
function areFloatsEqual(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) < epsilon;
}

/** 广播节流计时器。 */
let broadcastTimer: number | undefined;

/**
 * 【仅设置窗调用】只广播，不持久化（节流版）。
 * 用于滑块拖动时实时同步给主窗。
 */
export function broadcast(): void {
  if (broadcastTimer !== undefined) return;
  broadcastTimer = window.setTimeout(() => {
    broadcastTimer = undefined;
    const s = snapshot();
    const payload: DisplaySettingsPayload = { ...s, _src: SOURCE_ID };
    emit(DISPLAY_SETTINGS_CHANGED_EVENT, payload).catch(() => {});
  }, BROADCAST_THROTTLE_MS);
}

/**
 * 【仅设置窗调用】持久化并广播一次。
 * 主窗不要调用这个函数！
 */
export function saveAndBroadcast(): void {
  // 清除节流计时器，确保最终值一定会广播
  if (broadcastTimer !== undefined) {
    clearTimeout(broadcastTimer);
    broadcastTimer = undefined;
  }
  const s = snapshot();
  localStorage.setItem("pet-display-size", String(s.size));
  localStorage.setItem("pet-display-opacity", String(s.opacity));
  localStorage.setItem("pet-display-alwaysOnTop", String(s.alwaysOnTop));
  const payload: DisplaySettingsPayload = { ...s, _src: SOURCE_ID };
  emit(DISPLAY_SETTINGS_CHANGED_EVENT, payload).catch(() => {});
}

/**
 * 跨窗口同步：监听其他窗口广播的变更事件，更新本地响应式数据。
 * listen() 会注册全局监听器，模块只需加载一次即可生效。
 * `_src === SOURCE_ID` 表示是本窗口自己 emit 的回声，必须忽略。
 */
listen<DisplaySettingsPayload>(DISPLAY_SETTINGS_CHANGED_EVENT, (event) => {
  const p = event.payload;
  if (p._src === SOURCE_ID) return;
  if (!areFloatsEqual(size.value, p.size)) size.value = p.size;
  if (!areFloatsEqual(opacity.value, p.opacity)) opacity.value = p.opacity;
  if (alwaysOnTop.value !== p.alwaysOnTop) alwaysOnTop.value = p.alwaysOnTop;
});
