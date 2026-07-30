/**
 * 资源设置编辑区的共享类型 —— 由 `ResourceSettings.vue`（解析/组装 manifest）
 * 与拆分出来的 `ActionsCard.vue`/`BehaviorsCard.vue` 共用。
 */
import type { SpeakPhrase } from '../../pet-core/speakPhrases'

/** 一段位移的编辑行。 */
export interface MoveSegmentRow {
  /** 方向角（度）：0=正右，顺时针为正，90=正下。 */
  dir: number
  /** 速度（逻辑像素/秒），标量；0 = 原地停顿段。 */
  speed: number
  /** 持续毫秒；≤0 表示无限持续（其后的段永不执行）。 */
  ms: number
}

/** 动作编辑行。 */
export interface ActionRow {
  /** 标识：引用需要（base/enter/exit/random 都引用它），唯一；自动生成、用户不可见。 */
  key: string
  /** 显示名（可中文），仅界面展示，可空。 */
  name: string
  dir: string
  fps: number
  yoyo: boolean
  reverse: boolean
  offsetX: number
  offsetY: number
  scale: number
  /** 视觉对齐里的手动镜像：素材第一步怎么放（与运动无关的基础翻转）。 */
  flip: boolean
  /** 段序列走完是否回到第一段。 */
  moveLoop: boolean
  /** 撞屏幕边界是否反射（转身）。 */
  moveBounce: boolean
  /**
   * 移动时的素材朝向（已移进位移配置）：移动方向与它不一致时，在 flip 基础上再翻一次。
   * 仅在有位移段时才有意义；静止动作不移动、不参与朝向判断。
   */
  moveFacing: 'left' | 'right'
  /**
   * 位移段序列，**可为空**——空数组表示该动作不移动窗口（无位移配置）。
   * 有段时按序列行走，其中速度为 0 的段是「原地停顿」而非不移动的哨兵。
   * 组装 manifest 时：0 段不写 move 字段，≥1 段照常写。
   */
  moveSegments: MoveSegmentRow[]
}

/** 随机插播编辑行。 */
export interface RandomRow {
  action: string
  weight: number
  /** 仅 action === "__speak" 时有意义：该说话入口的独立短语池。 */
  phrases?: SpeakPhrase[]
}

/** 行为编辑行。 */
export interface BehaviorRow {
  /** 标识：行为 key（defaultBehavior/enter/exit/菜单触发都引用它），唯一；自动生成、用户不可见。 */
  key: string
  /** 显示名（可中文），仅界面展示，可空。 */
  label: string
  base: string
  enter: string
  exit: string
  weight: number
  interruptible: boolean
  /** 持续时长 [min,max]（按 durationUnit 的显示值）。 */
  durationVal: [number, number]
  /** 持续时长单位（毫秒因子：1000=秒 / 60000=分 / 3600000=时）。 */
  durationUnit: number
  /** 插播间隔 [min,max]（按 delayUnit 的显示值）。 */
  delayVal: [number, number]
  /** 插播间隔单位（毫秒因子）。 */
  delayUnit: number
  random: RandomRow[]
}

/** 动作下拉选项：值用 key、显示用名称。 */
export interface ActionOption {
  key: string
  label: string
}
