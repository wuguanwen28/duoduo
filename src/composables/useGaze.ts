/**
 * useGaze —— 将光标角度映射到对应的注视帧。
 *
 * 这是光标跟随行为,从 Pet.vue 中旧的内联逻辑里抽取出来。与按时序播放的动作
 * 不同,它由角度驱动:后端上报从猫头部到光标的顺时针屏幕角度,本组合式函数
 * 将其转换为内部的时钟约定并查找对应的帧。除了解析出的 `src` 之外,它有意保持
 * 纯函数 / 无状态。
 *
 * 注视映射表(时钟角度 → 帧索引):时钟角度以 0° = 朝上为起点,顺时针增大
 * (90° = 右,180° = 下,270° = 左)。这些锚点是从实际的精灵图上读取的;
 * 注视过程恰好在 169 帧的序列上顺时针完整循环一圈。
 */
import { computed, ref, type Ref } from "vue";
import { FOLLOW_FRAMES } from "../actions/frames";

const ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 15], // 上
  [45, 45], // 右上
  [90, 63], // 右
  [135, 81], // 右下
  [180, 93], // 下
  [225, 108], // 左下
  [270, 120], // 左
  [315, 135], // 左上
  [360, 168], // 上(闭合循环)
];

/** 分段线性查找:时钟角度(0..360)→ 帧索引。 */
export function angleToFrame(clock: number): number {
  const a = ((clock % 360) + 360) % 360;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a0, f0] = ANCHORS[i];
    const [a1, f1] = ANCHORS[i + 1];
    if (a >= a0 && a <= a1) {
      const t = (a - a0) / (a1 - a0);
      return Math.round(f0 + t * (f1 - f0));
    }
  }
  return 0;
}

export interface GazeController {
  /** 此刻要显示的注视帧的响应式 URL。 */
  currentSrc: Ref<string>;
  /** 当前解析出的帧索引(用于调试)。 */
  frameIndex: Ref<number>;
  /**
   * 输入一个新的注视采样。`screenAngle` 是后端的顺时针屏幕角度
   * (0 = 右,90 = 下),当光标处于头部死区内时为 `null` —— 此时猫朝向正前方
   * (frame 0)。
   */
  update: (screenAngle: number | null) => void;
}

export function useGaze(): GazeController {
  const frameIndex = ref(0);
  const frames = FOLLOW_FRAMES;

  const currentSrc = computed(
    () => frames[Math.min(frameIndex.value, frames.length - 1)] ?? frames[0] ?? "",
  );

  function update(screenAngle: number | null) {
    if (screenAngle === null) {
      frameIndex.value = 0;
      return;
    }
    // 将屏幕约定(0 = 右)转换为时钟约定(0 = 上)。
    const clock = (screenAngle + 90) % 360;
    frameIndex.value = angleToFrame(clock);
  }

  return { currentSrc, frameIndex, update };
}
