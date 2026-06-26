/**
 * 宠物可执行动作仓库。
 *
 * 所有能被手势配置绑定的动作都注册在这里，保持单一入口，便于设置页枚举和扩展。
 */
import type { Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CatBrain } from "./useCatBrain";
import { pickSpeakPhrase } from "./useSpeakPhrases";

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
  /** 空操作：用于禁用手势。 */
  none: () => {},

  /** 点击唤醒：若当前行为可被唤醒，则起身回 idle。 */
  wake: (ctx) => ctx.brain.wake(),

  /** 戳猫互动：播放一个空闲小动作。 */
  poke: (ctx) => ctx.brain.poke(),

  /** 随机说话（可配置短语与权重）。 */
  speak: (ctx) => {
    const msg = pickSpeakPhrase();
    if (msg) ctx.say(msg);
  },

  /** 戳猫互动 + 随机说话（可配置短语与权重）。 */
  pokeAndSpeak: (ctx) => {
    ctx.brain.poke();
    const msg = pickSpeakPhrase();
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

  /** 退出应用。 */
  quit: () => {
    invoke("pet_quit").catch((e) => console.error("pet_quit failed", e));
  },
};

/** 动作在设置页显示的中文标签。 */
export const ACTION_LABELS: Record<string, string> = {
  none: "无",
  wake: "切换行为",
  poke: "戳一下（随机小动作）",
  speak: "说话",
  pokeAndSpeak: "戳一下并说话",
  minimize: "最小化窗口",
  openMenu: "打开菜单",
  openSettings: "打开设置",
  toggleFollow: "切换跟随光标",
  togglePassthrough: "切换点击穿透",
  startCalibrate: "头部校准",
  quit: "退出应用",
};

/** 允许在手势配置中绑定的动作 key（过滤掉状态切换类动作）。 */
export const GESTURE_ACTION_KEYS: string[] = [
  "none",
  "wake",
  "poke",
  "speak",
  "pokeAndSpeak",
  "openMenu",
  "openSettings",
  "minimize",
  "quit",
];
