/**
 * 动作注册表 —— 每个基于定时器的精灵动画的声明式配置。
 *
 * “动作”是指任何由每秒帧数（fps）定时器驱动的行为（区别于跟随光标的
 * 注视行为，后者由角度驱动 —— 见 `useGaze`）。睡觉、wiki、喂食等都属于
 * 动作。状态机（`useCatBrain`）读取此表来决定如何播放以及何时可以中断
 * 某个动作。
 *
 * 添加新动作的步骤：
 * 1. 将帧以零填充的 `frame_XXXXXX.webp` 命名放入 `src/assets/<dir>/`。
 * 2. 在 `./frames.ts` 中添加一个 glob 条目和键（键必须与此处 `dir` 的用法一致）。
 * 3. 在下方添加一个条目，使用与 `FRAMES` 中相同的名称作为键。
 */

export interface ActionDef {
  /** 用于调试 / 提示弹窗的可读标签。 */
  label: string;
  /** 播放速度，单位为每秒帧数。 */
  fps: number;
  /** 永久循环（true）或播放一次后结束（false）。默认值：false。 */
  loop?: boolean;
  /**
   * 用于带一次性引导动画的循环动作：循环重新开始的帧索引。帧 `[0, loopFrom)`
   * 作为引导动画播放一次；到达末尾时播放跳回 `loopFrom` 而非 0，因此只有
   * 尾部循环。除非 `loop` 为 true 否则忽略。默认值：0（循环整个序列）。
   */
  loopFrom?: number;
  /**
   * 鼠标移动是否可以中断此动作并立即切回跟随状态。循环的环境类动作
   *（睡觉）通常可中断；有意为之的一次性动作（喂食）通常不可中断。
   * 默认值：true。
   */
  interruptible?: boolean;
  /**
   * 是否纳入空闲自动播放池。当猫空闲一段时间后，`useCatBrain` 会从中
   * 随机挑选一个播放。默认值：false。
   */
  idle?: boolean;
  /**
   * 对于循环动作，经过这么多毫秒后自动唤醒（结束），使本会无限循环的
   * 动作能自行结束。睡觉用到了它，因此即使从不点击，猫也会在一段时间后
   * 醒来。除非 `loop` 否则忽略。默认值：不自动唤醒。
   */
  autoWakeMs?: number;
}

export const ACTIONS: Record<string, ActionDef> = {
  wiki: {
    label: "wiki",
    fps: 24,
    loop: false,
    interruptible: true,
    idle: true,
  },
  sleep: {
    label: "睡觉",
    // 播放（趴下/呼吸/插播/起身/自动醒）已由 SLEEP_SEGMENTED + useSegmentedAction 接管，
    // 这里仅保留状态机用到的元数据：interruptible（鼠标移动不唤醒）、idle（纳入空闲自动播放池）、
    // label/fps。fps 对分段播放无效，仅为满足 ActionDef 类型而保留。
    fps: 24,
    interruptible: false,
    idle: true,
  },
} as const;

export type ActionName = keyof typeof ACTIONS;

/** 查找一个动作定义。 */
export function getAction(name: string): ActionDef | undefined {
  return ACTIONS[name];
}

/** 符合空闲自动播放条件的动作名称（`idle: true` 的子集）。 */
export const IDLE_POOL: string[] = Object.entries(ACTIONS)
  .filter(([, def]) => def.idle)
  .map(([name]) => name);
