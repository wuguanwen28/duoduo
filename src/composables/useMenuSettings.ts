/**
 * 右键菜单配置 —— 数据驱动的菜单项列表（环形辐射菜单的数据源）。
 *
 * 菜单项分三类：
 *   - builtin   内置功能（偷看 / 穿透 / 校准 / 老板来了 / 下班）；
 *   - action    动作（manifest.actions 里的某个动作，点一次播一次）；
 *   - behavior  行为（manifest.behaviors 里的某个行为，点一次切过去）。
 *
 * 全部存在 localStorage，key `pet-menu-settings`。
 * 【单向同步模式】：只有设置窗会调用 `saveAndBroadcast()` 广播；
 * 主窗只监听事件更新本地状态，永远不广播。
 */
import { ref } from "vue";
import { listen, emit } from "@tauri-apps/api/event";

/** 跨窗口同步事件名。 */
export const MENU_SETTINGS_CHANGED_EVENT = "menu-settings-changed";

/** localStorage 持久化键。 */
const STORAGE_KEY = "pet-menu-settings";

/** 菜单项的类型：内置功能 / 动作 / 行为。 */
export type MenuItemKind = "builtin" | "action" | "behavior";

/** 一个菜单项的配置。 */
export interface MenuItemConfig {
  /** 唯一 id（`kind:ref`），用于拖拽列表的 key 与去重。 */
  id: string;
  /** 类型。 */
  kind: MenuItemKind;
  /**
   * 引用目标：
   * - builtin 为功能标识（follow / passthrough / calibrate / boss / quit）；
   * - action / behavior 为对应的动作名 / 行为名。
   */
  ref: string;
  /** 展示用 emoji。 */
  emoji: string;
  /** 展示用中文标签（菜单上显示）。 */
  label: string;
  /** 设置页下拉中显示的标准名称；仅内置功能需要。 */
  standardLabel?: string;
}

/** 内置功能项的目录条目。 */
export interface BuiltinCatalogItem {
  /** 功能标识。 */
  ref: string;
  emoji: string;
  /** 菜单上显示的可爱/简短名称。 */
  label: string;
  /** 设置页下拉中显示的标准功能名称。 */
  standardLabel: string;
  /** 是否为开关型（开/关有高亮状态，如偷看 / 穿透）。 */
  isToggle: boolean;
}

/** 内置功能目录：配置页可选池与主菜单渲染共用。 */
export const BUILTIN_CATALOG: BuiltinCatalogItem[] = [
  { ref: "follow", emoji: "👀", label: "偷看", standardLabel: "切换跟随光标", isToggle: true },
  { ref: "passthrough", emoji: "🖱️", label: "穿透点击", standardLabel: "切换点击穿透", isToggle: true },
  { ref: "calibrate", emoji: "🎯", label: "校准猫头", standardLabel: "头部校准", isToggle: false },
  { ref: "boss", emoji: "🏃", label: "老板来了", standardLabel: "最小化窗口", isToggle: false },
  { ref: "quit", emoji: "👋", label: "下班", standardLabel: "退出应用", isToggle: false },
];

/** 猫爪菜单的 5 个固定槽位：4 趾 + 1 掌垫。 */
export const PAW_SLOTS = [
  { key: "toe-left",         label: "左趾",   position: 0 },
  { key: "toe-left-center",  label: "左中趾", position: 1 },
  { key: "toe-right-center", label: "右中趾", position: 2 },
  { key: "toe-right",        label: "右趾",   position: 3 },
  { key: "center-pad",       label: "掌垫",   position: 4 },
] as const;

export type PawSlotKey = (typeof PAW_SLOTS)[number]["key"];

/** 用 kind + ref 拼唯一 id。 */
export function menuItemId(kind: MenuItemKind, ref: string): string {
  return `${kind}:${ref}`;
}

/** 由内置目录条目构造一个菜单项配置。 */
function builtinItem(ref: string): MenuItemConfig {
  const b = BUILTIN_CATALOG.find((x) => x.ref === ref)!;
  return { id: menuItemId("builtin", b.ref), kind: "builtin", ref: b.ref, emoji: b.emoji, label: b.label };
}

/**
 * 首次默认菜单（5 个固定槽位，按猫爪位置排列）：
 * 左趾=偷看 / 左中趾=穿透点击 / 右中趾=睡觉 / 右趾=老板来了 / 掌垫=下班。
 */
function defaultMenu(): MenuItemConfig[] {
  return [
    builtinItem("follow"),
    builtinItem("passthrough"),
    { id: menuItemId("behavior", "sleep"), kind: "behavior", ref: "sleep", emoji: "😴", label: "睡觉" },
    builtinItem("boss"),
    builtinItem("quit"),
  ];
}

/** 校验单个菜单项结构是否合法。 */
function isValidItem(x: any): x is MenuItemConfig {
  return (
    x &&
    (x.kind === "builtin" || x.kind === "action" || x.kind === "behavior") &&
    typeof x.ref === "string" &&
    typeof x.emoji === "string" &&
    typeof x.label === "string"
  );
}

/** 从 localStorage 读取菜单配置；缺失或非法时回退到默认菜单。 */
function load(): MenuItemConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMenu();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultMenu();
    const items = parsed.filter(isValidItem).map((x) => ({
      id: typeof x.id === "string" ? x.id : menuItemId(x.kind, x.ref),
      kind: x.kind,
      ref: x.ref,
      emoji: x.emoji,
      label: x.label,
    }));
    return items.length > 0 ? items : defaultMenu();
  } catch {
    return defaultMenu();
  }
}

/** 当前菜单配置；组件直接读写本 ref。 */
export const menuSettings = ref<MenuItemConfig[]>(load());

/**
 * 【仅设置窗调用】持久化并广播一次。
 * 主窗不要调用这个函数！
 */
export function saveAndBroadcast(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(menuSettings.value));
  emit(MENU_SETTINGS_CHANGED_EVENT, menuSettings.value).catch(() => {});
}

/**
 * 跨窗口同步：监听其他窗口广播的变更事件，覆盖本地配置。
 * 模块级监听，生命周期与应用一致。比较序列化结果，避免无谓赋值。
 */
listen<MenuItemConfig[]>(MENU_SETTINGS_CHANGED_EVENT, (event) => {
  if (!Array.isArray(event.payload)) return;
  if (JSON.stringify(event.payload) !== JSON.stringify(menuSettings.value)) {
    menuSettings.value = event.payload;
  }
});
