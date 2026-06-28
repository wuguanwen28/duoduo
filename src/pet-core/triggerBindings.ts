/**
 * 触发器-动作统一绑定 —— 手势与快捷键合并为单一数组。
 *
 * - 鼠标手势（前4条固定）：trigger 为 MouseTrigger 枚举，仅可改动作。
 * - 键盘快捷键（动态新增）：trigger 为按键串，可改动作 / 作用域 / 删除。
 * 两者动作统一引用 PET_ACTIONS，由主窗分发时查表执行。
 *
 * 配置存 localStorage（key `duoduo-trigger-bindings`），并通过 Tauri 事件
 * 在设置窗与主窗之间同步。旧手势配置（`pet-gesture-config`）与旧快捷键
 * 配置（`duoduo-shortcuts`）首次加载时合并迁移，迁移后旧 key 保留作回退。
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

/** 旧手势配置的 trigger → id 固定映射（迁移用）。 */
const MOUSE_IDS: Record<MouseTrigger, string> = {
  leftClick: "m-leftClick",
  doubleClick: "m-doubleClick",
  rightClick: "m-rightClick",
  longPress: "m-longPress",
};

/** 旧快捷键 id → 迁移用 actionId 映射（boss-coming 一律迁成 minimize）。 */
const LEGACY_KEY_ACTION: Record<string, string> = {
  "boss-coming": "minimize",
  "open-settings": "openSettings",
  "toggle-passthrough": "togglePassthrough",
};

/** 旧快捷键 id → 迁移用 isGlobal 来源。 */
const LEGACY_KEY_GLOBAL: Record<string, boolean> = {
  "boss-coming": true,
  "open-settings": false,
  "toggle-passthrough": false,
};

/**
 * 默认预置绑定（首次加载无任何配置、或「恢复默认」时用）。
 * 鼠标 4 条默认与原 DEFAULT_GESTURE_CONFIG 一致；快捷键 3 条与原 SHORTCUT_DEFS
 * 一致，其中「老板来了」直接绑 minimize（它本就是最小化的别名）。
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

/** localStorage 持久化结构：仅含 entries 一字段，便于与旧格式区分。 */
interface StoredBindings {
  entries: TriggerBinding[];
}

/** 旧快捷键新格式（useShortcuts v1 曾用过的 {entries} 结构）。 */
interface LegacyShortcutsEntries {
  entries: { id: string; key: string; scope: "global" | "app"; actionId: string }[];
}

/**
 * 从 localStorage 读取触发器绑定列表。
 *
 * 优先级：
 * 1) 新格式（`{ entries: [...] }`）直接用；
 * 2) 旧手势 + 旧快捷键配置合并迁移，迁移后写回新 key；
 * 3) 都没有 → 默认预置（不写盘）。
 * 迁移幂等：读到新 key 即走分支 1，不再迁移。
 */
export function loadTriggerBindings(): TriggerBinding[] {
  let rawNew: string | null = null;
  try {
    rawNew = localStorage.getItem(TRIGGER_BINDINGS_STORAGE_KEY);
  } catch {
    return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));
  }

  // 分支 1：新格式
  if (rawNew) {
    try {
      const parsed = JSON.parse(rawNew) as StoredBindings;
      if (parsed && Array.isArray(parsed.entries)) {
        return parsed.entries.map((e) => ({ ...e }));
      }
    } catch {
      // 损坏 → 继续走迁移 / 默认
    }
  }

  // 分支 2：旧配置合并迁移
  const entries = migrateFromLegacy();
  if (entries) {
    saveTriggerBindings(entries);
    return entries;
  }

  // 分支 3：默认预置
  return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));
}

/**
 * 从旧手势配置（pet-gesture-config）与旧快捷键配置（duoduo-shortcuts）
 * 合并迁移出 TriggerBinding[]；任一旧配置都没有时返回 null。
 */
function migrateFromLegacy(): TriggerBinding[] | null {
  let gestureRaw: string | null = null;
  let shortcutRaw: string | null = null;
  try {
    gestureRaw = localStorage.getItem("pet-gesture-config");
    shortcutRaw = localStorage.getItem("duoduo-shortcuts");
  } catch {
    return null;
  }
  if (!gestureRaw && !shortcutRaw) return null;

  const entries: TriggerBinding[] = [];

  // 鼠标 4 条：从旧手势配置取 actionId，trigger 固定。
  let gesture: Record<string, string> | null = null;
  if (gestureRaw) {
    try {
      gesture = JSON.parse(gestureRaw) as Record<string, string>;
    } catch {
      gesture = null;
    }
  }
  const mouseDefaults: Record<MouseTrigger, string> = {
    leftClick: "pokeAndSpeak",
    doubleClick: "minimize",
    rightClick: "openMenu",
    longPress: "wake",
  };
  (Object.keys(MOUSE_IDS) as MouseTrigger[]).forEach((trigger) => {
    entries.push({
      id: MOUSE_IDS[trigger],
      kind: "mouse",
      trigger,
      actionId: gesture?.[trigger] ?? mouseDefaults[trigger],
    });
  });

  // 快捷键：从旧快捷键配置取，兼容旧裸对象与 {entries} 两种格式。
  if (shortcutRaw) {
    try {
      const parsed = JSON.parse(shortcutRaw);
      // {entries: [...]} 格式
      if (parsed && Array.isArray((parsed as LegacyShortcutsEntries).entries)) {
        for (const e of (parsed as LegacyShortcutsEntries).entries) {
          entries.push({
            id: e.id,
            kind: "key",
            trigger: e.key ?? "",
            actionId: e.actionId ?? "none",
            isGlobal: e.scope === "global",
          });
        }
      } else if (parsed && typeof parsed === "object") {
        // 旧裸对象 { "boss-coming": "Alt+Z", ... }
        const legacy = parsed as Record<string, string>;
        for (const id of Object.keys(LEGACY_KEY_ACTION)) {
          entries.push({
            id,
            kind: "key",
            trigger: typeof legacy[id] === "string" ? legacy[id] : "",
            actionId: LEGACY_KEY_ACTION[id],
            isGlobal: LEGACY_KEY_GLOBAL[id],
          });
        }
      }
    } catch {
      // 快捷键解析失败——仅保留已迁移的鼠标 4 条。
    }
  }

  return entries;
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
