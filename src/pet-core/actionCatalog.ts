/**
 * 动作 / 菜单的纯数据目录（零依赖）。
 *
 * 这里只放「配置层与运行时层都要用、且不依赖任何本地模块」的静态数据与纯函数：
 * 内置动作目录、猫爪槽位、鼠标手势标签等。把它们从 commands.ts / menuSettings.ts 抽出，
 * 是为了斩断 `defaults → commands → speakPhrases → defaults` 的循环 import，
 * 让 defaults.ts 能安全引用这些目录来构造默认菜单。
 *
 * 约束：本文件**不得** import 任何 ./ 本地模块，保持零依赖、可被任何层引用。
 */

// ── 内置动作目录（菜单 / 触发器下拉的「内置」组数据源） ────────────

/** 内置动作目录条目：菜单与触发器两处下拉的「内置」组共用。 */
export interface BuiltinAction {
  /** PET_ACTIONS 键，同时是 actionId 的内置形式。 */
  key: string;
  /** 菜单上显示的简短名。 */
  menuLabel: string;
  /** 设置页下拉显示的标准功能名。 */
  standardLabel: string;
  /** 是否为开关型（开 / 关有高亮，如偷看 / 穿透）。 */
  isToggle?: boolean;
}

/**
 * 内置动作目录：菜单与触发器两处下拉「内置」组的数据源。
 * 顺序即下拉顺序。
 */
export const BUILTIN_ACTIONS: BuiltinAction[] = [
  { key: "speak", menuLabel: "说话", standardLabel: "说话" },
  { key: "pokeAndSpeak", menuLabel: "戳并说话", standardLabel: "戳一下并说话" },
  { key: "toggleFollow", menuLabel: "偷看", standardLabel: "切换跟随光标", isToggle: true },
  { key: "togglePassthrough", menuLabel: "穿透点击", standardLabel: "切换点击穿透", isToggle: true },
  { key: "calibrate", menuLabel: "校准猫头", standardLabel: "头部校准" },
  { key: "minimize", menuLabel: "老板来了", standardLabel: "切换所有小猫显隐" },
  { key: "offWork", menuLabel: "下班", standardLabel: "关闭当前窗口" },
  { key: "quit", menuLabel: "退出", standardLabel: "退出应用" },
  { key: "openSettings", menuLabel: "设置", standardLabel: "打开设置" },
  { key: "openMenu", menuLabel: "打开菜单", standardLabel: "打开菜单" },
];

/** 按 key 查内置目录条目。 */
export function findBuiltin(key: string): BuiltinAction | undefined {
  return BUILTIN_ACTIONS.find((b) => b.key === key);
}

/**
 * 行为 random 插播可选的内置动作条目。
 *
 * 与 BUILTIN_ACTIONS 区分：那个面向「菜单 / 触发器」，含 minimize / quit /
 * openSettings 等不适合自治插播的动作；本表只列适合在 idle 等自治行为里
 * 随机插播的内置动作（当前仅「说话」）。
 *
 * key 带 `__` 前缀，写入 manifest 的 random[].action 字段；resources.ts 解析时
 * 凭前缀保留（不过滤），播放层 useBehavior 凭前缀转交 Pet.vue 执行对应 PET_ACTIONS。
 * `__` 是保留前缀，资源动作名不应以它开头（camelCase 标识符习惯下不会冲突）。
 */
export interface BuiltinTwitchAction {
  /** 写入 manifest 的标识，形如 `__speak`。 */
  key: string;
  /** 设置页下拉显示名。 */
  label: string;
}

export const BUILTIN_TWITCH_ACTIONS: BuiltinTwitchAction[] = [
  { key: "__speak", label: "💬 说话" },
];

// ── 猫爪菜单槽位（结构常量） ────────────────────────────────────

/** 猫爪菜单的 5 个固定槽位：4 趾 + 1 掌垫。 */
export const PAW_SLOTS = [
  { key: "toe-left", label: "左趾", position: 0 },
  { key: "toe-left-center", label: "左中趾", position: 1 },
  { key: "toe-right-center", label: "右中趾", position: 2 },
  { key: "toe-right", label: "右趾", position: 3 },
  { key: "center-pad", label: "掌垫", position: 4 },
] as const;

export type PawSlotKey = (typeof PAW_SLOTS)[number]["key"];

/** 用 actionId 拼唯一菜单项 id。 */
export function menuItemId(actionId: string): string {
  return actionId || "none";
}

// ── 鼠标手势标签 ───────────────────────────────────────────────

/** 鼠标手势触发方式的中文标签，供设置页只读显示。 */
export const MOUSE_TRIGGER_LABELS: Record<string, string> = {
  leftClick: "左键单击",
  doubleClick: "左键双击",
  rightClick: "右键",
  longPress: "长按",
};
