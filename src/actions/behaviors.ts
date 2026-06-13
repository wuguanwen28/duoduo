/**
 * 行为库 —— 像剧本一样按名字引用片段（见 `./clips.ts`）。
 *
 * 一个行为（Behavior）＝ 可选的 enter（进入放一次）→ 可选的 loop（呼吸基底 + 随机插播）
 * → 可选的 exit（退出放一次）。没有 loop 的行为是「一次性动作」（放完 enter/exit 即结束）。
 * 状态机（`useCatBrain`）读取本表来决定播放与中断。
 *
 * 新增行为：在 `./clips.ts` 加好片段，然后在此加一条引用这些片段名的行为即可
 *（不必再像旧设计那样登记两遍）。
 */

/** 循环段：基底 + 随机插播。 */
export interface BehaviorLoop {
  /** 基底片段名（呼吸等环境动作）。 */
  base: string;
  /** 随机插播的片段名列表（可空＝纯基底循环）。 */
  random: string[];
  /** 两次插播之间的随机间隔 [min,max]（毫秒）。 */
  delay: [number, number];
}

/** 一个行为。 */
export interface Behavior {
  /** 进入时正放一次的片段名（可选；一次性动作只配它）。 */
  enter?: string;
  /** 环境循环（可选；纯一次性动作不配）。 */
  loop?: BehaviorLoop;
  /** 退出时正放一次的片段名（可选；如 sleep 的 wakeUp）。 */
  exit?: string;
  /** 多少毫秒后自动结束（sleep 2 分钟自动醒）；不设＝不自动结束。仅对有 loop 的行为有意义。 */
  autoEndMs?: number;
  /** 鼠标移动能否打断并切回跟随，默认 false（只能点击/自动结束）。 */
  interruptible?: boolean;
  /** 能否被空闲自动播放挑中，默认 false。 */
  idleAuto?: boolean;
}

/** 行为库。 */
export const BEHAVIORS: Record<string, Behavior> = {
  idle: {
    // idle 是「休息态」本身，不参与 idleAuto 自动挑选。
    // 呼吸为底，每隔几秒随机眨眼/摇尾巴/动耳朵（摇尾巴与基底接缝相邻＝丝滑，
    // 眨眼/动耳朵非相邻＝离散播放，见 clips.ts 注释）。
    loop: {
      base: "idleBreathe",
      random: ["idleBlink", "idleTail", "idleEar"],
      delay: [5000, 11000],
    },
  },
  sleep: {
    enter: "lieDown",
    loop: { base: "sleepBreathe", random: ["sleepEar", "sleepTail"], delay: [3000, 7000] },
    exit: "wakeUp", // 醒来＝趴下倒放（靠片段 range 方向实现）
    autoEndMs: 120000,
    // interruptible 默认 false：睡觉不被鼠标移动打断，只能点击/2 分钟自动醒。
    idleAuto: true,
  },
  wiki: {
    enter: "wiki", // 只有 enter ＝ 一次性动作：放完即结束
    interruptible: true, // wiki 可被鼠标移动打断（覆盖默认 false）
    idleAuto: true,
  },
  feed: {
    enter: "feed", // 一次性投喂：放完即结束
    // interruptible 默认 false：投喂是用户主动行为，鼠标移动/点击都不打断，须完整播完。
    // 不设 idleAuto：只由菜单「投喂」触发，不会自动播放。
  },
};

/** 空闲自动播放池：`idleAuto` 为 true 的行为名。 */
export const IDLE_POOL: string[] = Object.entries(BEHAVIORS)
  .filter(([, b]) => b.idleAuto)
  .map(([name]) => name);
