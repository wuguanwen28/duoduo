/**
 * 行为库访问层 —— 从外置资源仓库（`./resources`）读取解析后的行为。
 *
 * 行为（Behavior）＝ 自治、可循环的状态：idle / sleep /（将来 walk）。每个有
 * enter?/loop/exit?，以及参与「加权轮换」的 weight 与 duration。useCatBrain 按
 * weight 随机在行为间轮换，跨行为切换播离开者的 exit、进入者的 enter。
 *
 * 旧版的「手动一次性动作」(ACTIONS：feed/wink) 已取消 —— feed/wink 现在是 idle
 * 行为的随机插播动作；需要手动触发某个动作时，由 useCatBrain.trigger 直接按
 * 动作名在当前行为里播一次。
 */
import {
  getModel,
  type Behavior,
  type TwitchItem,
  type BehaviorLoop,
} from './resources'

export type { Behavior, TwitchItem, BehaviorLoop }

/** 取行为库（行为名 → 行为）。数据来自已加载的外置资源。 */
export function getBehaviors(): Record<string, Behavior> {
  return getModel().behaviors
}

/** 取默认/兜底行为名（启动、follow 回落、触发动作的归属都用它）。 */
export { getDefaultBehavior } from './resources'
