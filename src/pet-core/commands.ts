/**
 * 宠物可执行动作仓库。
 *
 * 所有能被手势配置绑定的动作都注册在这里，保持单一入口，便于设置页枚举和扩展。
 */
import type { Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CatBrain } from "./useCatBrain";
import { pickFromPool, type SpeakPhrase } from "./speakPhrases";
import { getBehaviorNames } from "./resources";

/** 执行动作所需的上下文；由 Pet.vue 在实例化时注入。 */
export interface PetActionContext {
  /** 猫大脑实例。 */
  brain: CatBrain;
  /** 菜单显隐状态。 */
  menuOpen: Ref<boolean>;
  /** 校准显隐状态。 */
  calibrating: Ref<boolean>;
  /** 跟随光标开关。 */
  followCursor: Ref<boolean>;
  /** 点击穿透开关。 */
  passthrough: Ref<boolean>;
  /** 让猫说一句话（气泡提示）。 */
  say: (msg: string, ms?: number) => void;
  /**
   * 本次 speak / pokeAndSpeak 动作使用的独立短语池。
   * 由触发源（菜单 / 触发器 / 行为 random）在触发前填入，用完清空。
   * 缺省 / 空池时不出气泡。
   */
  speakPool?: SpeakPhrase[];
  /**
   * 把菜单放到指定窗口坐标；不传时居中。
   * 由手势引擎在触发前写入 pendingMenuPos，供 openMenu 等动作使用。
   */
  placeMenuAt: (cx?: number, cy?: number) => void;
  /** 最近一次触发手势的指针位置（由手势引擎维护）。 */
  pendingMenuPos: Ref<{ x: number; y: number } | undefined>;
}

/** 动作函数签名。 */
export type PetAction = (ctx: PetActionContext) => void;

/** 所有可绑定动作：key 同时作为手势配置的取值和设置页下拉选项的 value。 */
export const PET_ACTIONS: Record<string, PetAction> = {
  /** 点击唤醒：若当前行为可被唤醒，则起身回 idle。 */
  wake: (ctx) => ctx.brain.wake(),

  /** 戳猫互动：播放一个空闲小动作。 */
  poke: (ctx) => ctx.brain.poke(),

  /** 随机说话（从触发源传入的独立短语池里挑）。 */
  speak: (ctx) => {
    const msg = pickFromPool(ctx.speakPool ?? []);
    if (msg) ctx.say(msg);
  },

  /** 戳猫互动 + 随机说话（从触发源传入的独立短语池里挑）。 */
  pokeAndSpeak: (ctx) => {
    ctx.brain.poke();
    const msg = pickFromPool(ctx.speakPool ?? []);
    if (msg) ctx.say(msg);
  },

  /** 最小化窗口（原双击行为）。 */
  minimize: (ctx) => {
    ctx.menuOpen.value = false;
    getCurrentWindow()
      .minimize()
      .catch(() => {});
  },

  /** 打开右键菜单。 */
  openMenu: (ctx) => {
    const pos = ctx.pendingMenuPos.value;
    ctx.placeMenuAt(pos?.x, pos?.y);
  },

  /** 切换光标跟随。 */
  toggleFollow: (ctx) => {
    ctx.followCursor.value = !ctx.followCursor.value;
  },

  /** 切换点击穿透。 */
  togglePassthrough: (ctx) => {
    ctx.passthrough.value = !ctx.passthrough.value;
  },

  /** 打开设置窗口。 */
  openSettings: () => {
    invoke("pet_open_settings").catch(() => {});
  },

  /** 头部校准：进入校准态（菜单 / 快捷键统一入口）。 */
  calibrate: (ctx) => {
    ctx.calibrating.value = true;
  },

  /** 退出应用。 */
  quit: () => {
    invoke("pet_quit").catch((e) => console.error("pet_quit failed", e));
  },
};

/** 内置动作目录条目：菜单与触发器两处下拉的「内置」组共用。 */
export interface BuiltinAction {
  /** PET_ACTIONS 键，同时是 actionId 的内置形式。 */
  key: string;
  /** 菜单上显示的 emoji。 */
  emoji: string;
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
  { key: "speak", emoji: "💬", menuLabel: "说话", standardLabel: "说话" },
  { key: "pokeAndSpeak", emoji: "🗨️", menuLabel: "戳并说话", standardLabel: "戳一下并说话" },
  { key: "toggleFollow", emoji: "👀", menuLabel: "偷看", standardLabel: "切换跟随光标", isToggle: true },
  { key: "togglePassthrough", emoji: "🖱️", menuLabel: "穿透点击", standardLabel: "切换点击穿透", isToggle: true },
  { key: "calibrate", emoji: "🎯", menuLabel: "校准猫头", standardLabel: "头部校准" },
  { key: "minimize", emoji: "🏃", menuLabel: "老板来了", standardLabel: "最小化窗口" },
  { key: "quit", emoji: "👋", menuLabel: "下班", standardLabel: "退出应用" },
  { key: "openSettings", emoji: "⚙️", menuLabel: "设置", standardLabel: "打开设置" },
  { key: "openMenu", emoji: "🧭", menuLabel: "打开菜单", standardLabel: "打开菜单" },
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
  /** 设置页下拉显示名（含 emoji）。 */
  label: string;
}

export const BUILTIN_TWITCH_ACTIONS: BuiltinTwitchAction[] = [
  { key: "__speak", label: "💬 说话" },
];

/** 解析后的 actionId 分类。 */
export interface ParsedActionId {
  kind: "builtin" | "action" | "behavior" | "randomAction" | "randomBehavior" | "none";
  /** 仅 kind=action/behavior 时有值：动作 / 行为名。 */
  name?: string;
}

/**
 * 把 actionId 字符串解析成结构化分类。
 * - 内置键（PET_ACTIONS 的键）→ { kind:"builtin" }；
 * - `action:<名>` → { kind:"action", name }；
 * - `behavior:<名>` → { kind:"behavior", name }；
 * - `randomAction` / `randomBehavior` → 同名 kind；
 * - 空 / 未知名 → { kind:"none" }。
 */
export function parseActionId(id: string): ParsedActionId {
  if (!id) return { kind: "none" };
  if (id === "randomAction") return { kind: "randomAction" };
  if (id === "randomBehavior") return { kind: "randomBehavior" };
  if (id.startsWith("action:")) return { kind: "action", name: id.slice("action:".length) };
  if (id.startsWith("behavior:")) return { kind: "behavior", name: id.slice("behavior:".length) };
  if (PET_ACTIONS[id]) return { kind: "builtin" };
  return { kind: "none" };
}

/** 从非空字符串数组里随机挑一个；空数组返回 undefined。 */
function pickRandom(names: string[]): string | undefined {
  if (names.length === 0) return undefined;
  return names[Math.floor(Math.random() * names.length)];
}

/**
 * 统一动作分发：按 actionId 解析后执行。
 * 内置键走 PET_ACTIONS；动作 / 行为走 ctx.brain.trigger；
 * 随机动作从当前行为的 random 池挑一个播放；随机行为从所有行为里挑一个切换；
 * 空 / 未知为空操作。
 */
export function resolveAction(id: string, ctx: PetActionContext): void {
  const p = parseActionId(id);
  switch (p.kind) {
    case "builtin":
      PET_ACTIONS[id]?.(ctx);
      return;
    case "action":
    case "behavior":
      if (p.name) ctx.brain.trigger(p.name);
      return;
    case "randomAction": {
      ctx.brain.playCurrentBehaviorTwitch();
      return;
    }
    case "randomBehavior": {
      const n = pickRandom(getBehaviorNames());
      if (n) ctx.brain.trigger(n);
      return;
    }
    case "none":
    default:
      return;
  }
}

/** 鼠标手势触发方式的中文标签，供设置页只读显示。 */
export const MOUSE_TRIGGER_LABELS: Record<string, string> = {
  leftClick: "左键单击",
  doubleClick: "左键双击",
  rightClick: "右键",
  longPress: "长按",
};
