/**
 * 分段动作配置 —— sleep 与 idle 共用的声明式描述。
 *
 * 一个「分段动作」由可选的开场（intro）、循环基底（base）、随机插播的小动作
 * （twitches）和可选的退场（outro）组成。运行器（见 `useSegmentedAction`）读取
 * 本配置来编排播放：intro 正放一次 → base 循环 → 每隔随机间隔插播一个 twitch →
 * 收到退出请求时放 outro 一次。
 *
 * 区间端点约定：左闭右开（`start` 含、`end` 不含），与 `Array.prototype.slice`
 * 一致，运行器内统一用 `frames.slice(start, end)`。
 */
import { FRAMES, IDLE_FRAMES } from "./frames";

/** 一段帧区间（左闭右开）。 */
export interface SegmentRange {
  /** 起始帧索引（含）。 */
  start: number;
  /** 结束帧索引（不含）。 */
  end: number;
}

/** 一个随机插播的小动作。 */
export interface TwitchDef {
  /** 调试用标签，如 "ear" / "tail"。 */
  name: string;
  /** 该小动作的帧区间。 */
  range: SegmentRange;
  /** 随机权重，默认 1。 */
  weight?: number;
  /** 该段播放速度（fps），默认取动作级 fps。 */
  fps?: number;
  /**
   * yoyo 来回播放（正放 + 反放），默认 false。开启后该小动作会「出去再收回」，
   * 例如「摇尾巴」开启即等于连甩两下。
   */
  yoyo?: boolean;
}

/** 一个完整的分段动作配置。 */
export interface SegmentedActionDef {
  /** 源帧列表（sleep → cat-sleep；idle → cat-idla）。 */
  frames: string[];
  /** 进入时正放一次的开场段（可选）。 */
  intro?: SegmentRange;
  /** 循环基底段（默认 yoyo 来回，见 `baseYoyo`）。 */
  base: SegmentRange;
  /** 随机插播池（可为空数组＝纯基底循环）。 */
  twitches: TwitchDef[];
  /**
   * 退场段（可选）。传 `'introReversed'` 表示「把 intro 倒序播放」，
   * 用于睡觉起身＝趴下过程反放。
   */
  outro?: SegmentRange | "introReversed";
  /** 两次插播之间的随机间隔 [min, max]（毫秒）。 */
  twitchDelay: [number, number];
  /** 动作级默认播放速度（fps）。 */
  fps: number;
  /** intro / outro 单独的 fps（趴下/起身可调快），默认取 `fps`。 */
  introFps?: number;
  /** base 基底单独的 fps（呼吸帧少可调慢），默认取 `fps`。 */
  baseFps?: number;
  /** base 是否 yoyo 来回，默认 true。 */
  baseYoyo?: boolean;
  /** 自动结束的毫秒数（sleep 的 2 分钟自动醒）；不设＝不自动结束。 */
  autoEndMs?: number;
}

/**
 * 睡觉的分段配置。区间为「大概值」，端点按左闭右开换算（后续逐帧微调）：
 *   intro   0–189（趴下，倒放＝起身）
 *   base    180–195（安静呼吸）
 *   ear     195–214（动耳朵）
 *   tail    215–240（摇尾巴，yoyo＝连甩两下）
 */
export const SLEEP_SEGMENTED: SegmentedActionDef = {
  frames: FRAMES.sleep,
  intro: { start: 0, end: 190 }, // 与 base 故意重叠（大概区间，待逐帧定稿），勿当 off-by-one 修
  base: { start: 187, end: 200 },
  twitches: [
    { name: "ear", range: { start: 195, end: 215 } },
    { name: "tail", range: { start: 215, end: 241 }, yoyo: true },
  ],
  outro: "introReversed",
  twitchDelay: [3000, 7000],
  fps: 24,
  introFps: 36, // 趴下/起身稍快，避免 190 帧 @24fps ≈ 8s 过慢
  baseFps: 8, // 呼吸帧少，单独放慢（约 3 秒一次呼吸循环），可再调
  baseYoyo: true,
  autoEndMs: 120000,
};

/**
 * idle 的分段配置 —— 退化接入：整段 cat-idla 普通循环、无插播，行为与改动前一致。
 * 以后只需往 `twitches` 填区间、或设 `baseYoyo`/缩小 `base` 即可启用细分。
 */
export const IDLE_SEGMENTED: SegmentedActionDef = {
  frames: IDLE_FRAMES,
  base: { start: 0, end: IDLE_FRAMES.length },
  twitches: [],
  twitchDelay: [6000, 14000],
  fps: 24,
  baseYoyo: false,
};

/**
 * 可被 `trigger(name)` 触发、且由分段运行器播放的动作。
 * 不在此表中的动作（如 wiki）走 `useCatBrain` 里原有的一次性播放路径。
 * 注意：`IDLE_SEGMENTED` 故意不在此注册——idle 不通过 `trigger(name)` 触发，
 * 而是由 `useCatBrain` 的 `enterIdle` 直接消费。
 */
export const SEGMENTED_ACTIONS: Record<string, SegmentedActionDef> = {
  sleep: SLEEP_SEGMENTED,
};
