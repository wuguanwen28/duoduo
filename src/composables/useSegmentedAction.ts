/**
 * useSegmentedAction —— 通用「分段动作」运行器。
 *
 * 读取一份 `SegmentedActionDef`，把它编排成一段播放流程：
 *   intro    ：正放开场一次（若配置）→ 进入 base
 *   base     ：循环播放基底（默认 yoyo 来回）；同时挂随机定时器到点插播 twitch
 *   twitch   ：从池中按 weight 随机挑一个，正放一次 → 回 base（重排下次定时器）
 *   exiting  ：收到 requestExit；放 outro（含 introReversed＝开场倒放）一次 → 回调
 *
 * 它底层只用通用播放器 `useSpriteAnimation`，靠喂「切片 / yoyo 拼接 / 倒序」好的帧
 * 数组来实现 —— 不修改通用播放器。各段数组在 `start()` 时预切一次并缓存。
 */
import { onScopeDispose, type Ref } from "vue";
import { useSpriteAnimation } from "./useSpriteAnimation";
import type { SegmentedActionDef, SegmentRange, TwitchDef } from "../actions/segments";

/**
 * 把帧区间 `[start, end)` 切出来；`yoyo` 为真时做来回拼接。
 * 来回拼接去掉两端重复帧（A B C → A B C B），使循环 / 往返都无缝、两端不卡顿。
 */
function buildSegment(frames: string[], range: SegmentRange, yoyo: boolean): string[] {
  const fwd = frames.slice(range.start, range.end);
  if (!yoyo || fwd.length <= 2) return fwd;
  return [...fwd, ...fwd.slice(1, -1).reverse()];
}

/** 按权重随机挑一个下标；权重缺省为 1。 */
function pickWeighted(twitches: TwitchDef[]): number {
  const weights = twitches.map((t) => (t.weight ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export interface SegmentedController {
  /** 当前要显示的帧 URL（透传自底层播放器）。绑定到 <CatSprite :src>。 */
  currentSrc: Ref<string>;
  /**
   * 开始播放某个分段动作。会重置之前的播放。
   * `onAutoEnd` 在配置了 `autoEndMs` 且到点时被调用（等价于一次外部 requestExit）。
   */
  start(cfg: SegmentedActionDef, onAutoEnd?: () => void): void;
  /**
   * 请求退出：有 outro 则放完再调用 `onDone`；没有则立即停止并回调。
   * 退出期间重复调用会被忽略（处理「自动结束」与「点击」竞态）。
   */
  requestExit(onDone: () => void): void;
  /** 硬停：清掉所有定时器与播放，不放 outro、不回调。 */
  stop(): void;
}

export function useSegmentedAction(): SegmentedController {
  const player = useSpriteAnimation();

  // 当前配置与预切好的各段帧数组（start() 时填充）。
  let cfg: SegmentedActionDef | null = null;
  let introFrames: string[] = [];
  let outroFrames: string[] = [];
  let baseFrames: string[] = [];
  let twitchFrames: string[][] = [];

  let twitchTimer: number | undefined;
  let autoEndTimer: number | undefined;
  let exiting = false;
  let onAutoEnd: (() => void) | undefined;

  function clearTwitchTimer() {
    if (twitchTimer !== undefined) {
      window.clearTimeout(twitchTimer);
      twitchTimer = undefined;
    }
  }

  function clearAutoEndTimer() {
    if (autoEndTimer !== undefined) {
      window.clearTimeout(autoEndTimer);
      autoEndTimer = undefined;
    }
  }

  /** 进入基底循环，并排期下一次随机插播。 */
  function enterBase() {
    // 已在退出流程中则不再回到基底（防御：避免插播/intro 的 onDone 在退出后又重启循环）。
    if (!cfg || exiting) return;
    // 基底用 baseFps（呼吸帧少可调慢），未设则回退到动作级 fps。
    player.play(baseFrames, { fps: cfg.baseFps ?? cfg.fps, loop: true });
    scheduleTwitch();
  }

  /** 排期下一次插播（无插播池则不排）。 */
  function scheduleTwitch() {
    clearTwitchTimer();
    if (!cfg || cfg.twitches.length === 0) return;
    const [lo, hi] = cfg.twitchDelay;
    const delay = lo + Math.random() * Math.max(0, hi - lo);
    twitchTimer = window.setTimeout(playTwitch, delay);
  }

  /** 随机播一个插播小动作，播完回到基底。 */
  function playTwitch() {
    if (!cfg || exiting) return;
    const i = pickWeighted(cfg.twitches);
    const t = cfg.twitches[i];
    player.play(
      twitchFrames[i],
      { fps: t.fps ?? cfg.fps, loop: false },
      enterBase, // 插播结束后回到基底（并重排下次插播）
    );
  }

  function start(next: SegmentedActionDef, autoEnd?: () => void) {
    // 预切各段（左闭右开）。
    cfg = next;
    exiting = false;
    onAutoEnd = autoEnd;
    introFrames = next.intro ? buildSegment(next.frames, next.intro, false) : [];
    baseFrames = buildSegment(next.frames, next.base, next.baseYoyo ?? true);
    twitchFrames = next.twitches.map((t) =>
      buildSegment(next.frames, t.range, t.yoyo ?? false),
    );
    // outro：'introReversed' ＝ 开场倒序；否则按区间切。
    if (next.outro === "introReversed") {
      outroFrames = introFrames.slice().reverse();
    } else if (next.outro) {
      outroFrames = buildSegment(next.frames, next.outro, false);
    } else {
      outroFrames = [];
    }

    clearTwitchTimer();
    clearAutoEndTimer();

    // intro 正放一次 → 进基底；无 intro 直接进基底。
    if (introFrames.length > 0) {
      player.play(introFrames, { fps: next.introFps ?? next.fps, loop: false }, enterBase);
    } else {
      enterBase();
    }

    // 自动结束（sleep 的 2 分钟自动醒）。
    if (next.autoEndMs && next.autoEndMs > 0) {
      autoEndTimer = window.setTimeout(() => {
        requestExit(onAutoEnd ?? (() => {}));
      }, next.autoEndMs);
    }
  }

  function requestExit(onDone: () => void) {
    if (exiting) return; // 幂等：自动结束与点击竞态时只执行一次
    exiting = true;
    clearTwitchTimer();
    clearAutoEndTimer();
    if (outroFrames.length > 0) {
      // 新的 play 会覆盖上一段的 onDone（如 enterBase），故中途打断插播不会回到基底
      player.play(outroFrames, { fps: cfg?.introFps ?? cfg?.fps ?? 24, loop: false }, onDone);
    } else {
      player.stop();
      onDone();
    }
  }

  function stop() {
    clearTwitchTimer();
    clearAutoEndTimer();
    exiting = false;
    cfg = null;
    player.stop();
  }

  onScopeDispose(stop);

  return { currentSrc: player.currentSrc, start, requestExit, stop };
}
