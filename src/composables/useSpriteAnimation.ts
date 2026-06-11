/**
 * useSpriteAnimation — a generic frame-by-frame player driven by an fps timer.
 *
 * Shared by every timed action (wiki, sleep, future actions). It owns nothing
 * but the playback cursor: give it a frame list, call `play()`, and read
 * `currentSrc`. Looping vs. one-shot is per-`play()` (falling back to the
 * action's default), and a one-shot fires `onDone` when it finishes.
 *
 * It deliberately knows nothing about the action registry or the state
 * machine — those live in `useCatBrain`, which wires playback to behaviour.
 */
import { computed, onScopeDispose, ref, type Ref } from "vue";

export interface SpriteAnimationOptions {
  /** Frames per second. Default 24. */
  fps?: number;
  /** Loop forever when true; play once and stop when false. Default false. */
  loop?: boolean;
}

export interface SpriteAnimationController {
  /** Reactive URL of the frame to show right now (empty string when idle). */
  currentSrc: Ref<string>;
  /** Whether a sequence is currently playing. */
  isPlaying: Ref<boolean>;
  /** Current frame index (0-based) within the active frame list. */
  frameIndex: Ref<number>;
  /**
   * Start playing `frames`. Restarts from frame 0 if already playing.
   * `opts` overrides the defaults passed to the composable for this run.
   * `onDone` fires once when a non-looping sequence reaches its last frame
   * (never fires for `loop: true`).
   */
  play: (
    frames: string[],
    opts?: SpriteAnimationOptions,
    onDone?: () => void,
  ) => void;
  /** Stop immediately. Does not fire `onDone`. Clears `currentSrc`. */
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
    const interval = Math.max(1, Math.round(1000 / fps));

    frames.value = list;
    frameIndex.value = 0;
    isPlaying.value = true;
    doneCb = onDone;

    timer = window.setInterval(() => {
      const next = frameIndex.value + 1;
      if (next >= list.length) {
        if (loop) {
          frameIndex.value = 0;
        } else {
          // Hold the last frame, stop the timer, then notify.
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
