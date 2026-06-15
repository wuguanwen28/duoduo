/**
 * useGaze —— 将光标角度映射到对应的跟随帧。
 *
 * 由角度驱动（区别于按 fps 时序播放的动作）：后端上报猫头到光标的顺时针屏幕
 * 角度，本组合式函数转换为内部时钟约定，再用线性公式查出帧索引。
 *
 * 线性公式（取代旧的 anchors 表）：假定跟随帧是「等角度均匀」分布的。
 *   每帧角度 = 360 / 帧数；
 *   index = round((clock − startAngle) / 每帧角度)（顺时针）
 *           或 round((startAngle − clock) / 每帧角度)（逆时针），再对帧数取模。
 * 时钟约定：0=上, 90=右, 180=下, 270=左。配置来自 manifest 的 `follow`。
 */
import { computed, ref, type Ref } from "vue";
import { getModel } from "../resources/store";

export interface GazeController {
  /** 此刻要显示的跟随帧的响应式 URL。 */
  currentSrc: Ref<string>;
  /** 当前解析出的帧索引（用于调试）。 */
  frameIndex: Ref<number>;
  /**
   * 输入一个新的注视采样。`screenAngle` 是后端的顺时针屏幕角度（0=右, 90=下），
   * 光标处于头部死区内时为 `null` —— 此时锁定到第 0 帧。
   */
  update: (screenAngle: number | null) => void;
}

export function useGaze(): GazeController {
  const frameIndex = ref(0);
  // 跟随配置一次性读取（无跟随素材时为 null）。资源若热重载需重建本控制器。
  const follow = getModel().follow;

  const currentSrc = computed(() => {
    const frames = follow?.frames ?? [];
    if (frames.length === 0) return "";
    return frames[Math.min(frameIndex.value, frames.length - 1)] ?? frames[0] ?? "";
  });

  function update(screenAngle: number | null) {
    if (!follow || follow.frames.length === 0 || screenAngle === null) {
      frameIndex.value = 0;
      return;
    }
    // 屏幕约定(0=右,90=下) → 时钟约定(0=上,90=右,180=下,270=左)。
    const clock = (screenAngle + 90) % 360;
    const count = follow.frames.length;
    const degPerFrame = 360 / count;
    const delta = follow.clockwise
      ? (clock - follow.startAngle + 360) % 360
      : (follow.startAngle - clock + 360) % 360;
    const idx = Math.round(delta / degPerFrame);
    frameIndex.value = ((idx % count) + count) % count;
  }

  return { currentSrc, frameIndex, update };
}
