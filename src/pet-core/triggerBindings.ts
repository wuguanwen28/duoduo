/**
 * 触发器-动作统一绑定 —— 手势与快捷键合并为单一数组。
 *
 * - 鼠标手势（前4条固定）：trigger 为 MouseTrigger 枚举，仅可改动作。
 * - 键盘快捷键（动态新增）：trigger 为按键串，可改动作 / 作用域 / 删除。
 * 两者动作统一引用 PET_ACTIONS，由主窗分发时查表执行。
 *
 * 配置存 localStorage（key `duoduo-trigger-bindings`），并通过 Tauri 事件
 * 在设置窗与主窗之间同步。
 */
import { ref } from "vue";

/** 触发类型。 */
export type TriggerKind = "mouse" | "key";

/** 鼠标手势的固定触发方式枚举。 */
export type MouseTrigger = "leftClick" | "doubleClick" | "rightClick" | "longPress";

/** 单条触发器-动作绑定。 */
export interface TriggerBinding {
  /** 稳定标识，用于持久化 / 分发 / 冲突标记 / v-for key。 */
  id: string;
  /** 触发类型：mouse=鼠标手势（前4条固定），key=键盘快捷键（动态新增）。 */
  kind: TriggerKind;
  /**
   * 触发方式：
   * - kind=mouse：MouseTrigger 枚举值（只读）。
   * - kind=key：录制出的按键串 "Alt+Z"；空串=未绑定。
   */
  trigger: string;
  /** 触发动作，引用 PET_ACTIONS 的 key。 */
  actionId: string;
  /** 仅 kind=key 有效：是否系统层全局注册。mouse 不使用此字段。 */
  isGlobal?: boolean;
}

/** localStorage 键。 */
export const TRIGGER_BINDINGS_STORAGE_KEY = "duoduo-trigger-bindings";

/** 设置窗改动保存后广播；主窗收到后重新应用全部绑定。 */
export const TRIGGER_BINDINGS_CHANGED_EVENT = "trigger-bindings-changed";

/** 主窗应用后回传注册结果；设置窗据此把被占用的全局键标红。 */
export const TRIGGER_BINDINGS_RESULT_EVENT = "trigger-bindings-result";

/** 主窗回传的注册结果载荷。 */
export interface TriggerResult {
  /** 注册失败（疑似被其他程序占用）的全局快捷键 id 列表。 */
  failedIds: string[];
}

/**
 * 默认预置绑定（首次加载无任何配置、或「恢复默认」时用）。
 * 鼠标 4 条 + 快捷键 3 条。
 */
export const DEFAULT_TRIGGER_BINDINGS: TriggerBinding[] = [
  { id: "m-leftClick", kind: "mouse", trigger: "leftClick", actionId: "pokeAndSpeak" },
  { id: "m-doubleClick", kind: "mouse", trigger: "doubleClick", actionId: "minimize" },
  { id: "m-rightClick", kind: "mouse", trigger: "rightClick", actionId: "openMenu" },
  { id: "m-longPress", kind: "mouse", trigger: "longPress", actionId: "wake" },
  { id: "k-boss", kind: "key", trigger: "Alt+Z", actionId: "minimize", isGlobal: true },
  { id: "k-settings", kind: "key", trigger: "Alt+S", actionId: "openSettings", isGlobal: false },
  { id: "k-passthrough", kind: "key", trigger: "Alt+C", actionId: "togglePassthrough", isGlobal: false },
];

/** localStorage 持久化结构。 */
interface StoredBindings {
  entries: TriggerBinding[];
}

/**
 * 从 localStorage 读取触发器绑定列表。
 * 无配置或损坏时返回默认预置（不写盘）。
 */
export function loadTriggerBindings(): TriggerBinding[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TRIGGER_BINDINGS_STORAGE_KEY);
  } catch {
    return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));
  }

  if (!raw) return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));

  try {
    const parsed = JSON.parse(raw) as StoredBindings;
    if (parsed && Array.isArray(parsed.entries)) {
      return parsed.entries.map((e) => ({ ...e }));
    }
  } catch {
    // 损坏 → 回默认
  }

  return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));
}

/** 把绑定列表写回 localStorage（新格式 `{ entries }`，全量写入）。 */
export function saveTriggerBindings(entries: TriggerBinding[]): void {
  const data: StoredBindings = { entries: entries.map((e) => ({ ...e })) };
  localStorage.setItem(TRIGGER_BINDINGS_STORAGE_KEY, JSON.stringify(data));
}

/** 当前生效的触发器绑定（模块级 ref，主窗读它）。 */
export const triggerBindings = ref<TriggerBinding[]>(loadTriggerBindings());

// ── 按键序列化（从原 useShortcuts 迁入） ────────────────────────

/**
 * 把键盘事件序列化为内部按键串（如 `"Ctrl+Shift+A"`）。
 * 纯修饰键、Escape 返回 `null`（调用方据此忽略或取消录制）。
 */
export function serializeKeyEvent(e: KeyboardEvent): string | null {
  const { ctrlKey, shiftKey, altKey, metaKey, key } = e;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  if (key === "Escape") return null;
  const parts: string[] = [];
  if (ctrlKey) parts.push("Ctrl");
  if (shiftKey) parts.push("Shift");
  if (altKey) parts.push("Alt");
  if (metaKey) parts.push("Meta");
  let mainKey = key;
  if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
  else if (mainKey === " ") mainKey = "Space";
  parts.push(mainKey);
  return parts.join("+");
}

/** 判断某次 keydown 是否命中给定按键串（用于应用内快捷键匹配）。 */
export function matchesKey(e: KeyboardEvent, key: string): boolean {
  if (!key) return false;
  return serializeKeyEvent(e) === key;
}

/** 内部修饰键 → Tauri accelerator 修饰键名。 */
const ACCEL_MODIFIERS: Record<string, string> = {
  Ctrl: "Control",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "Super",
};

/** 个别主键名到 Tauri accelerator 的映射（其余字母/数字/功能键直接透传）。 */
const ACCEL_KEYS: Record<string, string> = {
  Space: "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/**
 * 把内部按键串转成 global-shortcut 接受的 accelerator
 * （如 `"Ctrl+Shift+A"` → `"Control+Shift+A"`）。空串返回空串。
 */
export function toAccelerator(key: string): string {
  if (!key) return "";
  const parts = key.split("+");
  const out: string[] = [];
  parts.forEach((p, i) => {
    if (i < parts.length - 1) {
      out.push(ACCEL_MODIFIERS[p] ?? p);
    } else {
      out.push(ACCEL_KEYS[p] ?? p);
    }
  });
  return out.join("+");
}

/** 把按键串格式化为更友好的显示文本（`Meta` 显示为 `Win`）。 */
export function formatKey(key: string): string {
  return key
    .split("+")
    .map((k) => (k === "Meta" ? "Win" : k))
    .join(" + ");
}
