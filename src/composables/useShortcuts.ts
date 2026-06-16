/**
 * 快捷键配置与共享逻辑。
 *
 * - 设置窗（`ShortcutSettings.vue`）用它读默认定义、序列化按键、持久化并广播变更。
 * - 主窗（`Pet.vue`）用它加载配置、注册全局快捷键、匹配应用内快捷键。
 *
 * 两类作用域：
 * - `"global"`：经 `tauri-plugin-global-shortcut` 在系统层注册，**任何程序活跃时都触发**；
 *   可能与其他软件冲突（注册失败），由调用方据返回结果向用户提示，无法强行抢占。
 * - `"app"`：仅**主窗口聚焦**时由 keydown 捕获，天然不会与其他软件发生全局冲突。
 *
 * 按键串采用内部格式 `"Ctrl+Shift+A"`（修饰键固定顺序 Ctrl→Shift→Alt→Meta，
 * 末尾跟一个主键）。空串表示「未绑定」。
 */

/** 快捷键作用域。 */
export type ShortcutScope = "global" | "app";

/** 单条快捷键的静态定义。 */
export interface ShortcutDef {
  /** 唯一标识，用于持久化、动作分发与冲突标记。 */
  id: string;
  /** 显示名称。 */
  name: string;
  /** 功能说明。 */
  description: string;
  /** 作用域：全局或仅应用内。 */
  scope: ShortcutScope;
  /** 默认绑定的按键串（内部格式，如 `"Alt+Z"`）；空串表示默认不绑定。 */
  defaultKey: string;
}

/** localStorage 键：仅存 `id → key` 的映射。 */
export const SHORTCUTS_STORAGE_KEY = "duoduo-shortcuts";

/** 设置窗改动保存后广播；主窗收到后重新应用全部快捷键。 */
export const SHORTCUTS_CHANGED_EVENT = "shortcuts-changed";

/** 主窗应用后回传注册结果；设置窗据此把「被占用」的全局键标红。 */
export const SHORTCUTS_RESULT_EVENT = "shortcuts-result";

/** 主窗回传的注册结果载荷。 */
export interface ShortcutResult {
  /** 注册失败（疑似被其他程序占用）的全局快捷键 id 列表。 */
  failedIds: string[];
}

/**
 * 快捷键定义表。`boss-coming` 为全局（默认 Alt+Z，显隐来回切换），其余应用内。
 * 修改此表即可增删快捷键，设置窗与主窗都从这里取。
 */
export const SHORTCUT_DEFS: ShortcutDef[] = [
  {
    id: "boss-coming",
    name: "老板来了",
    description: "一键隐藏 / 显示",
    scope: "global",
    defaultKey: "Alt+Z",
  },
  {
    id: "open-settings",
    name: "打开设置",
    description: "打开设置窗口",
    scope: "app",
    defaultKey: "Alt+S",
  },
  {
    id: "toggle-passthrough",
    name: "切换穿透",
    description: "开启或关闭鼠标穿透",
    scope: "app",
    defaultKey: "Alt+C",
  },
];

/**
 * 从 localStorage 读取 `id → key` 映射。
 *
 * 未保存过任何配置时整体回落到默认值；保存过则以保存值为准（包括用户主动清空＝空串），
 * 仅对「保存后新增的快捷键 id」回落到其默认值。
 */
export function loadShortcutMap(): Record<string, string> {
  let saved: Record<string, string> | null = null;
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as Record<string, string>;
  } catch {
    saved = null;
  }
  const map: Record<string, string> = {};
  for (const def of SHORTCUT_DEFS) {
    if (saved && def.id in saved) {
      map[def.id] = saved[def.id];
    } else {
      map[def.id] = def.defaultKey;
    }
  }
  return map;
}

/** 把当前 `id → key` 映射写回 localStorage（全量写入，含空串，便于区分「清空」与「新增」）。 */
export function saveShortcutMap(map: Record<string, string>): void {
  localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(map));
}

/**
 * 把键盘事件序列化为内部按键串（如 `"Ctrl+Shift+A"`）。
 * 纯修饰键、Escape 返回 `null`（调用方据此忽略或取消录制）。
 */
export function serializeKeyEvent(e: KeyboardEvent): string | null {
  const { ctrlKey, shiftKey, altKey, metaKey, key } = e;

  // 纯修饰键按下（只按住 Ctrl 等）不构成快捷键。
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  // Escape 留作取消录制。
  if (key === "Escape") return null;

  const parts: string[] = [];
  if (ctrlKey) parts.push("Ctrl");
  if (shiftKey) parts.push("Shift");
  if (altKey) parts.push("Alt");
  if (metaKey) parts.push("Meta");

  // 字母统一大写；空格归一为可读名；其余功能键保留原名。
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
 * 把内部按键串转成 `tauri-plugin-global-shortcut` 接受的 accelerator
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
      // 末段为主键。
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
