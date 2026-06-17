/**
 * 资源设置编辑区的共享类型 —— 由 `ResourceSettings.vue`（解析/组装 manifest）
 * 与拆分出来的 `ActionsCard.vue`/`BehaviorsCard.vue` 共用。
 */

/** 动作编辑行。 */
export interface ActionRow {
  /** 标识：引用需要（base/enter/exit/random 都引用它），唯一；自动生成、用户不可见。 */
  key: string;
  /** 显示名（可中文），仅界面展示，可空。 */
  name: string;
  dir: string;
  fps: number;
  yoyo: boolean;
  reverse: boolean;
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** 随机插播编辑行。 */
export interface RandomRow {
  action: string;
  weight: number;
}

/** 行为编辑行。 */
export interface BehaviorRow {
  /** 标识：行为 key（defaultBehavior/enter/exit/菜单触发都引用它），唯一；自动生成、用户不可见。 */
  key: string;
  /** 显示名（可中文），仅界面展示，可空。 */
  label: string;
  base: string;
  enter: string;
  exit: string;
  weight: number;
  interruptible: boolean;
  /** 持续时长 [min,max]（按 durationUnit 的显示值）。 */
  durationVal: [number, number];
  /** 持续时长单位（毫秒因子：1000=秒 / 60000=分 / 3600000=时）。 */
  durationUnit: number;
  /** 插播间隔 [min,max]（按 delayUnit 的显示值）。 */
  delayVal: [number, number];
  /** 插播间隔单位（毫秒因子）。 */
  delayUnit: number;
  random: RandomRow[];
}

/** 动作下拉选项：值用 key、显示用名称。 */
export interface ActionOption {
  key: string;
  label: string;
}
