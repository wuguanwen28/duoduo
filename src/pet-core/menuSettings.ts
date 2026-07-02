/**
 * 右键菜单配置 —— 数据驱动的菜单项列表（环形辐射菜单的数据源）。
 *
 * 菜单项统一通过 actionId 引用动作：
 *   - 内置功能键（如 toggleFollow / minimize / quit 等）；
 *   - action:<名>   引用 manifest.actions 里的某个动作，点一次播一次；
 *   - behavior:<名> 引用 manifest.behaviors 里的某个行为，点一次切过去；
 *   - randomAction / randomBehavior 表示从当前资源里随机挑一个。
 *
 * 全部存在 localStorage，key `pet-menu-settings`。
 * 【单向同步模式】：只有设置窗会调用 `saveAndBroadcast()` 广播；
 * 主窗只监听事件更新本地状态，永远不广播。
 */
import { ref } from "vue";
import { listen, emit } from "@tauri-apps/api/event";
import { findBuiltin } from "./commands";

/** 跨窗口同步事件名。 */
export const MENU_SETTINGS_CHANGED_EVENT = "menu-settings-changed";

/** localStorage 持久化键。 */
const STORAGE_KEY = "pet-menu-settings";

/** 菜单项配置：统一用 actionId 引用动作（内置键 / action:<名> / behavior:<名> / randomAction / randomBehavior）。 */
export interface MenuItemConfig {
  /** 唯一 id（基于 actionId），用于拖拽列表的 key 与去重。 */
  id: string;
  /** 动作引用，见统一 actionId 方案。 */
  actionId: string;
  /** 展示用 emoji。 */
  emoji: string;
  /** 展示用中文标签（菜单上显示）。 */
  label: string;
}

/** 猫爪菜单的 5 个固定槽位：4 趾 + 1 掌垫。 */
export const PAW_SLOTS = [
  { key: "toe-left",         label: "左趾",   position: 0 },
  { key: "toe-left-center",  label: "左中趾", position: 1 },
  { key: "toe-right-center", label: "右中趾", position: 2 },
  { key: "toe-right",        label: "右趾",   position: 3 },
  { key: "center-pad",       label: "掌垫",   position: 4 },
] as const;

export type PawSlotKey = (typeof PAW_SLOTS)[number]["key"];

/** 用 actionId 拼唯一 id。 */
export function menuItemId(actionId: string): string {
  return actionId || "none";
}

/** 由内置目录 key 构造一个菜单项配置（emoji / label 取自目录）。 */
function builtinItem(key: string): MenuItemConfig {
  const b = findBuiltin(key)!;
  return { id: menuItemId(key), actionId: key, emoji: b.emoji, label: b.menuLabel };
}

/**
 * 首次默认菜单（5 个固定槽位，按猫爪位置排列）：
 * 左趾=偷看 / 左中趾=穿透点击 / 右中趾=睡觉 / 右趾=老板来了 / 掌垫=下班。
 */
function defaultMenu(): MenuItemConfig[] {
  return [
    builtinItem("toggleFollow"),
    builtinItem("togglePassthrough"),
    { id: menuItemId("behavior:sleep"), actionId: "behavior:sleep", emoji: "😴", label: "睡觉" },
    builtinItem("minimize"),
    builtinItem("quit"),
  ];
}

/** 校验单个菜单项结构是否合法（新结构）。 */
function isValidItem(x: any): x is MenuItemConfig {
  return (
    x &&
    typeof x.actionId === "string" &&
    typeof x.emoji === "string" &&
    typeof x.label === "string"
  );
}

/** 从 localStorage 读取菜单配置；缺失、非法、或解析后为空时回退到默认菜单。 */
function load(): MenuItemConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMenu();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultMenu();
    const items: MenuItemConfig[] = parsed.filter(isValidItem);
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
