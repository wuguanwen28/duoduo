/**
 * useSpriteAnimation —— 一个由 fps 定时器驱动的通用逐帧播放器。
 *
 * 被所有按时序播放的动作(wink、sleep 以及未来的动作)共享。它只持有播放游标
 * 这一项状态:给它一个帧列表,调用 `play()`,然后读取 `currentSrc`。循环还是
 * 一次性播放由每次 `play()` 决定(缺省时回退到该动作的默认值),一次性播放在
 * 结束时会触发 `onDone`。
 *
 * 它有意对动作注册表和状态机一无所知 —— 那些都在 `useCatBrain` 中,由后者将
 * 播放与行为关联起来。
 */
import { computed, onScopeDispose, ref, type Ref } from "vue";

export interface SpriteAnimationOptions {
  /** 每秒帧数。默认 24。 */
  fps?: number;
  /** 为 true 时永久循环;为 false 时播放一次后停止。默认 false。 */
  loop?: boolean;
  /**
   * 循环时,到达末尾后从哪个帧索引重新开始。位于其之前的帧作为开场只播放一次。
   * 除非 `loop` 为 true,否则忽略此项。默认 0。
   */
  loopFrom?: number;
}

export interface SpriteAnimationController {
  /** 此刻要显示的帧的响应式 URL(空闲时为空字符串)。 */
  currentSrc: Ref<string>;
  /** 当前是否有序列正在播放。 */
  isPlaying: Ref<boolean>;
  /** 在当前活动帧列表中的当前帧索引(从 0 开始)。 */
  frameIndex: Ref<number>;
  /**
   * 开始播放 `frames`。若已在播放,则从 frame 0 重新开始。
   * `opts` 会覆盖本次运行中传给该组合式函数的默认值。
   * 当非循环序列到达其最后一帧时,`onDone` 触发一次(`loop: true` 时永不触发)。
   */
  play: (
    frames: string[],
    opts?: SpriteAnimationOptions,
    onDone?: () => void,
  ) => void;
  /** 立即停止。不触发 `onDone`。清空 `currentSrc`。 */
  stop: () => void;
}

export function useSpriteAnimation(
  defaults: SpriteAnimationOptions = {},
): SpriteAnimationController {
  const frames = ref<string[]>([]);
  const frameIndex = ref(0);
  const isPlaying = ref(false);
  let timer: number | undefined;
  let doneCb: (() => void) | undefined;

  const currentSrc = computed(() => {
    const list = frames.value;
    if (!isPlaying.value || list.length === 0) return "";
    return list[Math.min(frameIndex.value, list.length - 1)] ?? "";
  });

  function clearTimer() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function stop() {
    clearTimer();
    isPlaying.value = false;
    doneCb = undefined;
  }

  function play(
    list: string[],
    opts: SpriteAnimationOptions = {},
    onDone?: () => void,
  ) {
    clearTimer();
    if (!list || list.length === 0) {
      isPlaying.value = false;
      return;
    }

    const fps = opts.fps ?? defaults.fps ?? 24;
    const loop = opts.loop ?? defaults.loop ?? false;
    // 将循环点钳制到有效范围内;无效值则直接循环整个列表。
    const rawLoopFrom = opts.loopFrom ?? defaults.loopFrom ?? 0;
    const loopFrom =
      rawLoopFrom > 0 && rawLoopFrom < list.length ? rawLoopFrom : 0;
    const interval = Math.max(1, Math.round(1000 / fps));

    frames.value = list;
    frameIndex.value = 0;
    isPlaying.value = true;
    doneCb = onDone;

    timer = window.setInterval(() => {
      const next = frameIndex.value + 1;
      if (next >= list.length) {
        if (loop) {
          frameIndex.value = loopFrom;
        } else {
          // 停留在最后一帧,停止定时器,然后发出通知。
          frameIndex.value = list.length - 1;
          clearTimer();
          isPlaying.value = false;
          const cb = doneCb;
          doneCb = undefined;
          cb?.();
        }
      } else {
        frameIndex.value = next;
      }
    }, interval);
  }

  onScopeDispose(stop);

  return { currentSrc, isPlaying, frameIndex, play, stop };
}
