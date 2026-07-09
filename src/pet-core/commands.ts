/**
 * 宠物可执行动作仓库。
 *
 * 所有能被手势配置绑定的动作都注册在这里，保持单一入口，便于设置页枚举和扩展。
 */
import type { Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CatBrain } from "./useCatBrain";
import { pickFromPool, speakPhrases, type SpeakPhrase } from "./speakPhrases";
import { getBehaviorNames } from "./resources";
// BUILTIN_ACTIONS/findBuiltin/BUILTIN_TWITCH_ACTIONS/MOUSE_TRIGGER_LABELS 等纯数据
// 已抽到零依赖的 actionCatalog；此处从其 re-export，兼容旧引用路径（外部仍从 commands 拿）。
export {
  BUILTIN_ACTIONS,
  type BuiltinAction,
  findBuiltin,
  BUILTIN_TWITCH_ACTIONS,
  type BuiltinTwitchAction,
  MOUSE_TRIGGER_LABELS,
} from "./actionCatalog";

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
   * 缺省 / 空池时回退到全局「说话内容」（speakPhrases）；全局也为空才不出气泡。
   */
  speakPool?: SpeakPhrase[];
  /**
   * 把菜单放到指定窗口坐标；不传时居中。
   * 由手势引擎在触发前写入 pendingMenuPos，供 openMenu 等动作使用。
   */
  placeMenuAt: (cx?: number, cy?: number) => void;
  /** 最近一次触发手势的指针位置（由手势引擎维护）。 */
  pendingMenuPos: Ref<{ x: number; y: number } | undefined>;
  /** 当前窗口的猫 id；打开设置页时带入，使设置页默认编辑/激活这只猫。 */
  catId: string;
}

/** 动作函数签名。 */
export type PetAction = (ctx: PetActionContext) => void;

/**
 * 说话取词（含全局回退）：优先用触发源传入的独立短语池，池缺省 / 为空 / 全 0 权重
 * 时回退到全局「说话内容」（speakPhrases）。两者都取不到才返回空串（不出气泡）。
 *
 * 供 speak / pokeAndSpeak 共用，保证鼠标手势 / 快捷键 / 菜单等所有说话入口回退行为一致。
 */
function pickSpeakMessage(pool?: SpeakPhrase[]): string {
  return pickFromPool(pool ?? []) || pickFromPool(speakPhrases.value);
}

/** 所有可绑定动作：key 同时作为手势配置的取值和设置页下拉选项的 value。 */
export const PET_ACTIONS: Record<string, PetAction> = {
  /** 点击唤醒：若当前行为可被唤醒，则起身回 idle。 */
  wake: (ctx) => ctx.brain.wake(),

  /** 戳猫互动：播放一个空闲小动作。 */
  poke: (ctx) => ctx.brain.poke(),

  /** 随机说话（优先触发源的独立短语池，未配则回退全局说话内容）。 */
  speak: (ctx) => {
    const msg = pickSpeakMessage(ctx.speakPool);
    if (msg) ctx.say(msg);
  },

  /** 戳猫互动 + 随机说话（优先触发源的独立短语池，未配则回退全局说话内容）。 */
  pokeAndSpeak: (ctx) => {
    ctx.brain.poke();
    const msg = pickSpeakMessage(ctx.speakPool);
    if (msg) ctx.say(msg);
  },

  /**
   * 「老板来了」：一键切换**所有**小猫窗的显隐（后端 toggle_pet 遍历 cat-* 窗，
   * 有任一可见就全部藏起、否则全部恢复）。全局快捷键无论由哪只猫窗注册触发，
   * 都影响全体，故不再用 getCurrentWindow() 只管自己那只。
   */
  minimize: (ctx) => {
    ctx.menuOpen.value = false;
    invoke("pet_toggle_visibility").catch(() => {});
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

  /** 打开设置窗口；带当前猫 id 使设置页默认编辑/激活这只猫。
   *  快捷键路径在 Pet.vue dispatchKeyBinding 内特判、不传 catId，以保持「快捷键打开不激活」。 */
  openSettings: (ctx) => {
    invoke("pet_open_settings", { catId: ctx.catId }).catch(() => {});
  },

  /** 头部校准：进入校准态（菜单 / 快捷键统一入口）。 */
  calibrate: (ctx) => {
    ctx.calibrating.value = true;
  },

  /** 「下班」：关闭当前这只猫的窗口（应用仍在托盘，可从设置页「上班」恢复）。 */
  offWork: (ctx) => {
    ctx.menuOpen.value = false;
    getCurrentWindow()
      .close()
      .catch(() => {});
  },

  /** 退出应用（整个 app 关闭）。 */
  quit: () => {
    invoke("pet_quit").catch((e) => console.error("pet_quit failed", e));
  },
};

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
