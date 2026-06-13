/**
 * 行为库 + 动作库 —— 像剧本一样按名字引用片段（见 ./clips.ts）。
 *
 * 行为（Behavior）＝ 自治、可循环的状态：idle / sleep /（将来 walk）。每个有
 * enter?/loop/exit?，以及参与「加权轮换」的 weight 与 duration。useCatBrain 按 weight
 * 随机在行为间轮换，跨行为切换播离开者的 exit、进入者的 enter。
 *
 * 动作（Action）＝ 手动触发的一次性动作：feed / wiki。每个归属一个行为(home)，触发时
 * 切到该行为并把指定片段(clip)播一次，然后留在该行为的 loop 里。
 */

/** 一个随机插播项：片段名 + 相对权重。 */
export interface TwitchItem {
  /** 插播片段名。 */
  clip: string;
  /** 被选中的相对权重（同一 loop 内归一化比较），省略默认 1。 */
  weight?: number;
}

/** 循环段：基底 + 随机插播。 */
export interface BehaviorLoop {
  /** 基底片段名（呼吸等环境动作）。 */
  base: string;
  /** 随机插播项列表（可空＝纯基底循环），按各自 weight 加权随机挑选。 */
  random: TwitchItem[];
  /** 两次插播之间的随机间隔 [min,max]（毫秒）。 */
  delay: [number, number];
}

/** 一个自治行为。 */
export interface Behavior {
  /** 进入时正放一次的片段名（sleep: lieDown；idle: 无）。 */
  enter?: string;
  /** 环境循环（自治行为必有，轮换期间持续播放）。 */
  loop: BehaviorLoop;
  /** 离开时正放一次的片段名（sleep: wakeUp；idle: 无）。 */
  exit?: string;
  /** 加权轮换被选中的相对权重（idle 高、sleep 低）。 */
  weight: number;
  /** 本行为持续多久(ms)后触发下一次轮换，随机区间 [min,max]。 */
  duration: [number, number];
  /** 鼠标移动能否抢占进 follow，默认 false。 */
  interruptible?: boolean;
}

/** 一个手动一次性动作。 */
export interface ActionDef {
  /** 归属行为名。 */
  home: string;
  /** 触发时要播放的片段名。 */
  clip: string;
}

/** 行为库（参与加权轮换）。 */
export const BEHAVIORS: Record<string, Behavior> = {
  idle: {
    // 呼吸为底，待机时随机眨眼/摇尾巴/动耳朵/吃一下/wiki 一下。
    // 眨眼/摇尾/动耳是高频小动作给高权重；feed/wiki 较「重」故低权重、偶尔出现。
    loop: {
      base: "idleBreathe",
      random: [
        { clip: "idleBlink", weight: 5 },
        { clip: "idleTail", weight: 5 },
        { clip: "idleEar", weight: 5 },
        { clip: "feed", weight: 1 },
        { clip: "wiki", weight: 1 },
      ],
      delay: [3000, 8000],
    },
    weight: 10, // 大部分时间待机
    duration: [15000, 40000],
    interruptible: true, // 鼠标移动可抢占进 follow
  },
  sleep: {
    enter: "lieDown",
    loop: {
      base: "sleepBreathe",
      random: [
        { clip: "sleepEar", weight: 1 },
        { clip: "sleepTail", weight: 1 },
      ],
      delay: [3000, 7000],
    },
    exit: "wakeUp", // 醒来＝趴下倒放（靠片段 range 方向实现）
    weight: 2, // 偶尔睡
    duration: [60000, 120000], // 睡 1–2 分钟（取代旧的 autoEndMs）
    // interruptible 默认 false：睡觉不被鼠标移动打断，只能点击/时长到。
  },
  // walk: 将来加，需 cat-walk 素材。
};

/** 动作库（手动触发的一次性动作）。 */
export const ACTIONS: Record<string, ActionDef> = {
  feed: { home: "idle", clip: "feed" },
  wiki: { home: "idle", clip: "wiki" },
};
