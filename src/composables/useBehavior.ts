/**
 * useBehavior —— 行为播放器。
 *
 * 把一个 Behavior 编排成：enter?（播一次）→ lead?（一次性动作，可选）→ loop。
 * loop = base 循环播放（base 的 yoyo 已在 clipFrames 里展开成来回），其间每隔
 * 一段随机间隔从 random 池按权重挑一个动作离散播一次，播完回到 base 循环。
 *
 * 新模型下每个动作是独立帧文件夹，不再做「同源接缝丝滑续播」的播放头优化 ——
 * base 与各插播都用同一个 useSpriteAnimation 实例切换帧序列即可。
 *
 * 行为本身不会自动结束 —— 何时退出/轮换由 useCatBrain 的轮换定时器调
 * requestExit 驱动。
 */
import { onScopeDispose, type Ref } from "vue";
import { useSpriteAnimation } from "./useSpriteAnimation";
import { getClip, clipFrames } from "../actions/clips";
import type { Behavior, TwitchItem } from "../actions/behaviors";

export interface BehaviorController {
  /** 当前要显示的帧 URL。绑定到 <CatSprite :src>。 */
  currentSrc: Ref<string>;
  /** 开始一个行为：enter? → lead?（一次性动作）→ loop。一直循环到 requestExit/stop。 */
  start(behavior: Behavior, opts?: { lead?: string }): void;
  /** 请求退出：有 exit 则播完再 onDone，否则立即 onDone。退出期间重复调用被忽略。 */
  requestExit(onDone: () => void): void;
  /** 硬停：清掉所有定时器与播放，不播 exit、不回调。 */
  stop(): void;
  /** 是否处于可点击唤醒的点（已进入 loop 且未退出）。enter/lead/exit 期间为 false。 */
  canWake(): boolean;
  /** 在当前循环中插播一次指定动作，播完回到 base 循环。 */
  playOneShot(name: string): void;
  /**
   * 脱离行为、独立把某动作播一次，播完回调 onDone。用于无默认行为（纯跟随）
   * 时的「测试播放 / 触发动作」——此时没有 base 循环可回。名字无效时立即 onDone。
   */
  playClipOnce(name: string, onDone?: () => void): void;
}

export function useBehavior(): BehaviorController {
  const anim = useSpriteAnimation();
  const currentSrc = anim.currentSrc;

  let behavior: Behavior | null = null;
  let exiting = false;
  // 是否已进入 loop：仅此时允许点击唤醒。enter/lead/exit 期间为 false。
  let inLoop = false;
  let twitchTimer: number | undefined;

  function clearTwitch() {
    if (twitchTimer !== undefined) {
      window.clearTimeout(twitchTimer);
      twitchTimer = undefined;
    }
  }

  /** 播放一个动作一次（离散），结束回调 done。名字无效时立即 done。 */
  function playOnce(name: string | undefined, done: () => void) {
    const c = name ? getClip(name) : undefined;
    if (!c) {
      done();
      return;
    }
    anim.play(clipFrames(c), { fps: c.fps, loop: false }, done);
  }

  /** 循环播放当前行为的 base 动作。 */
  function playBase() {
    const base = behavior ? getClip(behavior.loop.base) : undefined;
    if (!base) return;
    anim.play(clipFrames(base), { fps: base.fps, loop: true });
  }

  /** 进入 loop：开始 base 循环并排期插播。 */
  function beginLoop() {
    if (!behavior) return;
    inLoop = true;
    playBase();
    scheduleNextTwitch();
  }

  /** 按各插播项 weight 加权随机挑一个；权重和为 0 时等概率。 */
  function pickWeighted(items: TwitchItem[]): TwitchItem | null {
    if (items.length === 0) return null;
    const total = items.reduce((sum, t) => sum + (t.weight ?? 1), 0);
    if (total <= 0) return items[Math.floor(Math.random() * items.length)];
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.weight ?? 1;
      if (r < 0) return item;
    }
    return items[items.length - 1];
  }

  /** 排期下一次随机插播。 */
  function scheduleNextTwitch() {
    clearTwitch();
    const loop = behavior?.loop;
    if (!loop || loop.random.length === 0) return;
    const [lo, hi] = loop.delay;
    const delay = lo + Math.random() * Math.max(0, hi - lo);
    twitchTimer = window.setTimeout(() => {
      if (exiting || !inLoop) return;
      const pick = pickWeighted(loop.random);
      if (!pick) {
        scheduleNextTwitch();
        return;
      }
      playOnce(pick.clip, () => {
        if (exiting) return;
        playBase();
        scheduleNextTwitch();
      });
    }, delay);
  }

  function playOneShot(name: string) {
    if (exiting || !inLoop) return;
    clearTwitch();
    playOnce(name, () => {
      if (exiting) return;
      playBase();
      scheduleNextTwitch();
    });
  }

  function playClipOnce(name: string, onDone?: () => void) {
    clearTwitch();
    anim.stop();
    behavior = null;
    exiting = false;
    inLoop = false;
    playOnce(name, () => onDone?.());
  }

  function start(b: Behavior, opts?: { lead?: string }) {
    clearTwitch();
    anim.stop();
    behavior = b;
    exiting = false;
    inLoop = false;
    const toLoop = () => {
      if (!exiting) beginLoop();
    };
    const afterEnter = () => {
      if (exiting) return;
      // lead：进入 loop 前先把一次性动作（如 feed）播一次。
      if (opts?.lead) playOnce(opts.lead, toLoop);
      else toLoop();
    };
    if (b.enter) playOnce(b.enter, afterEnter);
    else afterEnter();
  }

  function requestExit(onDone: () => void) {
    if (exiting) return; // 幂等：轮换与点击竞态只执行一次
    exiting = true;
    inLoop = false; // 开始退出：退出期间不再允许点击唤醒
    clearTwitch();
    if (behavior?.exit) {
      playOnce(behavior.exit, onDone);
    } else {
      anim.stop();
      onDone();
    }
  }

  function stop() {
    clearTwitch();
    anim.stop();
    exiting = false;
    inLoop = false;
    behavior = null;
  }

  function canWake() {
    return inLoop;
  }

  onScopeDispose(stop);

  return { currentSrc, start, requestExit, stop, canWake, playOneShot, playClipOnce };
}
