/**
 * 手势配置 —— 左键单击 / 双击 / 右键 / 长按分别绑定什么动作。
 *
 * 配置存 localStorage（key `pet-gesture-config`），并通过 Tauri 事件
 * 在设置窗与主窗之间单向同步。拖动行为固定为「拖动窗口」，不参与配置。
 */
import { ref } from "vue";
import { listen, emit } from "@tauri-apps/api/event";

/** 跨窗口同步事件名。 */
export const GESTURE_CONFIG_CHANGED_EVENT = "gesture-config-changed";

/** 可配置的手势类型。 */
export interface GestureConfig {
  /** 左键单击动作。 */
  leftClick: string;
  /** 左键双击动作。 */
  doubleClick: string;
  /** 右键动作。 */
  rightClick: string;
  /** 长按动作。 */
  longPress: string;
}

/** 默认手势配置：与 Pet.vue 原行为保持一致。 */
export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  leftClick: "pokeAndSpeak",
  doubleClick: "minimize",
  rightClick: "openMenu",
  longPress: "wake",
};

const STORAGE_KEY = "pet-gesture-config";

/** 从 localStorage 读取配置；缺失或非法字段用默认值补齐。 */
function loadGestureConfig(): GestureConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_GESTURE_CONFIG, ...parsed };
    }
  } catch {
    // 解析失败——回退到默认配置。
  }
  return { ...DEFAULT_GESTURE_CONFIG };
}

/** 当前手势配置；模块级 ref，主窗与设置窗共享同一份内存引用。 */
export const gestureConfig = ref<GestureConfig>(loadGestureConfig());

/**
 * 持久化并广播配置变更。
 * 设置窗调用；主窗只监听不广播，避免死循环。
 */
export function saveGestureConfig(config: GestureConfig): void {
  gestureConfig.value = { ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  emit(GESTURE_CONFIG_CHANGED_EVENT, config).catch(() => {});
}

/**
 * 跨窗口同步：监听其他窗口广播的变更事件。
 * 模块级监听，应用生命周期内只需注册一次。
 */
listen<GestureConfig>(GESTURE_CONFIG_CHANGED_EVENT, (event) => {
  gestureConfig.value = { ...DEFAULT_GESTURE_CONFIG, ...event.payload };
});
