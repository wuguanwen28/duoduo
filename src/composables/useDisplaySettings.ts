/**
 * 显示设置 —— 大小、透明度、窗口层级。
 *
 * 全部存在 localStorage，key 前缀 `pet-display-`。
 * 通过 Tauri 事件系统实现主窗与设置窗口之间的跨窗口同步。
 */
import { ref, watch } from "vue";
import { listen, emit } from "@tauri-apps/api/event";

/** 跨窗口同步事件名。 */
export const DISPLAY_SETTINGS_CHANGED_EVENT = "display-settings-changed";

/** 显示设置结构。 */
export interface DisplaySettings {
  size: number;
  opacity: number;
  alwaysOnTop: boolean;
}

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

/** 将当前显示设置序列化为可广播的对象。 */
function snapshot(): DisplaySettings {
  return {
    size: size.value,
    opacity: opacity.value,
    alwaysOnTop: alwaysOnTop.value,
  };
}

/** 广播显示设置变更事件（同时持久化到 localStorage）。 */
function broadcast(s: DisplaySettings) {
  localStorage.setItem("pet-display-size", String(s.size));
  localStorage.setItem("pet-display-opacity", String(s.opacity));
  localStorage.setItem("pet-display-alwaysOnTop", String(s.alwaysOnTop));
  emit(DISPLAY_SETTINGS_CHANGED_EVENT, s).catch(() => {});
}

/** 自动持久化并广播：本窗口内任何字段变更时触发。 */
watch([size, opacity, alwaysOnTop], () => broadcast(snapshot()));

/**
 * 跨窗口同步：监听其他窗口广播的变更事件，更新本地响应式数据。
 * listen() 会注册全局监听器，模块只需加载一次即可生效。
 */
listen<DisplaySettings>(DISPLAY_SETTINGS_CHANGED_EVENT, (event) => {
  const p = event.payload;
  if (size.value !== p.size) size.value = p.size;
  if (opacity.value !== p.opacity) opacity.value = p.opacity;
  if (alwaysOnTop.value !== p.alwaysOnTop) alwaysOnTop.value = p.alwaysOnTop;
});
