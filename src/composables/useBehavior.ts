/**
 * useBehavior —— 行为播放器。
 *
 * 把一个 Behavior 编排成：enter?（离散放一次）→ lead?（一次性动作片段，可选）→ loop。
 * loop 用「播放头」（绝对帧 cur ±1）驱动：base 在 [baseLo,baseHi] 来回摆动；与 base 同源
 * 且接缝相邻（起始帧＝baseHi+1）的插播从接缝续进、走到头再走回（丝滑链）。enter/exit/lead/
 * 非相邻插播是离散片段，用 useSpriteAnimation 整段播放。`using` 决定当前帧取哪一路。
 *
 * 行为本身不会自动结束 —— 何时退出/轮换由 useCatBrain 的轮换定时器调 requestExit 驱动。
 */
import { computed, onScopeDispose, ref, type Ref } from "vue";
import { useSpriteAnimation } from "./useSpriteAnimation";
import { CLIPS, SOURCES, resolveClip } from "../actions/clips";
import type { Behavior } from "../actions/behaviors";

/** 预处理好的插播信息。 */
interface PreparedTwitch {
  name: string;
  /** 加权随机挑选时的相对权重（来自 BehaviorLoop.random[i].weight，默认 1）。 */
  weight: number;
  /** 该插播覆盖的最大绝对帧索引（excursion 走到这里）。 */
  hi: number;
  fps: number;
  /** 与 base 同源且起始帧＝baseHi+1（可丝滑续播）。 */
  adjacent: boolean;
  /** 仅非相邻时用：离散播放的帧数组。 */
  frames: string[];
}

export interface BehaviorController {
  /** 当前要显示的帧 URL。绑定到 <CatSprite :src>。 */
  currentSrc: Ref<string>;
  /** 开始一个行为：enter? → lead?（一次性动作片段）→ loop。一直循环到 requestExit/stop。 */
  start(behavior: Behavior, opts?: { lead?: string }): void;
  /** 请求退出：有 exit 则放完再 onDone，否则立即 onDone。退出期间重复调用被忽略。 */
  requestExit(onDone: () => void): void;
  /** 硬停：清掉所有定时器与播放，不放 exit、不回调。 */
  stop(): void;
  /** 是否处于可点击唤醒的点（已进入 loop 且未退出）。enter/lead/exit 期间为 false。 */
  canWake(): boolean;
  /** 在当前循环中插播一次指定片段，播完后从接缝恢复循环。 */
  playOneShot(clipName: string): void;
}

export function useBehavior(): BehaviorController {
  const clip = useSpriteAnimation(); // 离散片段：enter / lead / exit / 非相邻插播
  const loopSrc = ref(""); // 播放头当前帧
  const using = ref<"clip" | "loop">("loop");

  const currentSrc = computed(() =>
    using.value === "clip" ? clip.currentSrc.value : loopSrc.value,
  );

  let behavior: Behavior | null = null;
  let exiting = false;
  // 是否已进入 loop：仅此时允许点击唤醒。enter/lead/exit 期间为 false。
  let inLoop = false;

  // 播放头 / 循环状态
  let srcFrames: string[] = [];
  let baseLo = 0;
  let baseHi = 0;
  let baseFps = 24;
  let twitches: PreparedTwitch[] = [];
  let cur = 0;
  let phase: "breatheUp" | "breatheDown" | "out" | "back" = "breatheUp";
  let excHi = 0;
  let excFps = 24;
  let pendingAdj: number | null = null;

  let stepTimer: number | undefined;
  let twitchTimer: number | undefined;

  function clearStepTimer() {
    if (stepTimer !== undefined) { window.clearTimeout(stepTimer); stepTimer = undefined; }
  }
  function clearTwitchTimer() {
    if (twitchTimer !== undefined) { window.clearTimeout(twitchTimer); twitchTimer = undefined; }
  }
  function clearAllTimers() {
    clearStepTimer();
    clearTwitchTimer();
  }

  /** 离散片段（enter/lead/exit/非相邻插播）整段播放一次。 */
  function playClip(name: string, done: () => void) {
    const c = CLIPS[name];
    if (!c) { done(); return; }
    using.value = "clip";
    clip.play(resolveClip(c), { fps: c.fps, loop: false }, done);
  }

  /** 进入循环：建立播放头状态并开始呼吸 + 排期插播。 */
  function beginLoop() {
    const loop = behavior?.loop;
    if (!loop) return;
    const base = CLIPS[loop.base];
    if (!base) return; // 基底片段名配置错误：优雅停在当前帧而非抛错
    srcFrames = SOURCES[base.src] ?? [];
    baseLo = Math.min(base.range[0], base.range[1]);
    baseHi = Math.max(base.range[0], base.range[1]) - 1;
    baseFps = base.fps;
    twitches = loop.random
      .map((item) =>
        CLIPS[item.clip] ? { name: item.clip, weight: item.weight ?? 1, clip: CLIPS[item.clip] } : null,
      )
      .filter(
        (x): x is { name: string; weight: number; clip: typeof CLIPS[string] } => x !== null,
      )
      .map(({ name, weight, clip: c }) => {
        const lo = Math.min(c.range[0], c.range[1]);
        const hi = Math.max(c.range[0], c.range[1]) - 1;
        const adjacent = c.src === base.src && lo === baseHi + 1;
        // 相邻插播走播放头「出去再回来」本身就是 yoyo，故忽略其 yoyo 标志、也不预切帧；
        // 非相邻插播才离散播放（此时才用其 yoyo，由 resolveClip 处理）。
        return { name, weight, hi, fps: c.fps, adjacent, frames: adjacent ? [] : resolveClip(c) };
      });
    cur = baseLo;
    phase = "breatheUp";
    pendingAdj = null;
    inLoop = true; // 已进入 loop：从此刻起允许点击唤醒
    using.value = "loop";
    loopSrc.value = srcFrames[cur] ?? "";
    scheduleNextTwitch();
    scheduleStep();
  }

  /** 链式步进器：按当前段 fps 推进一帧。 */
  function scheduleStep() {
    clearStepTimer();
    const fps = phase === "out" || phase === "back" ? excFps : baseFps;
    stepTimer = window.setTimeout(() => {
      advance();
      if (using.value === "loop" && !exiting) scheduleStep();
    }, Math.max(1, Math.round(1000 / fps)));
  }

  /** 推进播放头一帧并处理相位转换。 */
  function advance() {
    switch (phase) {
      case "breatheUp":
        if (cur < baseHi) cur++;
        if (cur >= baseHi) {
          cur = baseHi;
          if (pendingAdj !== null) {
            const t = twitches[pendingAdj];
            pendingAdj = null;
            excHi = t.hi;
            excFps = t.fps;
            phase = "out"; // 在接缝处转向插播
          } else {
            phase = "breatheDown";
          }
        }
        break;
      case "breatheDown":
        if (cur > baseLo) cur--;
        if (cur <= baseLo) { cur = baseLo; phase = "breatheUp"; }
        break;
      case "out":
        if (cur < excHi) cur++;
        if (cur >= excHi) { cur = excHi; phase = "back"; }
        break;
      case "back":
        if (cur > baseHi) cur--;
        if (cur <= baseHi) {
          resumeBreatheFromSeam(); // 回到接缝，从尾帧继续呼吸（向下）
          scheduleNextTwitch();
        }
        break;
    }
    loopSrc.value = srcFrames[cur] ?? "";
  }

  /** 回到接缝（baseHi）并从尾帧继续呼吸（向下）。base 与插播两条返回路径共用。 */
  function resumeBreatheFromSeam() {
    cur = baseHi;
    phase = "breatheDown";
    loopSrc.value = srcFrames[cur] ?? "";
  }

  /** 按各插播项的 weight 加权随机挑一个下标。权重和为 0 时退化为等概率。 */
  function pickWeightedTwitch(): number {
    const total = twitches.reduce((sum, t) => sum + t.weight, 0);
    if (total <= 0) return Math.floor(Math.random() * twitches.length);
    let r = Math.random() * total;
    for (let i = 0; i < twitches.length; i++) {
      r -= twitches[i].weight;
      if (r < 0) return i;
    }
    return twitches.length - 1; // 浮点兜底
  }

  /** 排期下一次随机插播。 */
  function scheduleNextTwitch() {
    clearTwitchTimer();
    const loop = behavior?.loop;
    if (!loop || loop.random.length === 0) return;
    const [lo, hi] = loop.delay;
    const delay = lo + Math.random() * Math.max(0, hi - lo);
    twitchTimer = window.setTimeout(() => {
      if (exiting) return;
      const idx = pickWeightedTwitch();
      if (twitches[idx].adjacent) {
        pendingAdj = idx; // 等播放头摆到接缝再出发（见 advance）
      } else {
        launchDiscrete(idx); // 不相邻：离散硬切
      }
    }, delay);
  }

  /** 非相邻插播：暂停播放头，离散播放一次，播完从接缝恢复呼吸。 */
  function launchDiscrete(idx: number) {
    clearStepTimer();
    const t = twitches[idx];
    using.value = "clip";
    clip.play(t.frames, { fps: t.fps, loop: false }, () => {
      if (exiting) return;
      using.value = "loop";
      resumeBreatheFromSeam(); // 回到接缝（此处一次硬切，属非相邻兜底）
      scheduleNextTwitch();
      scheduleStep();
    });
  }

  function playOneShot(clipName: string) {
    if (exiting || !inLoop) return;
    clearStepTimer();
    clearTwitchTimer();
    playClip(clipName, () => {
      if (exiting) return;
      using.value = "loop";
      resumeBreatheFromSeam();
      scheduleNextTwitch();
      scheduleStep();
    });
  }

  function start(b: Behavior, opts?: { lead?: string }) {
    clearAllTimers();
    clip.stop();
    behavior = b;
    exiting = false;
    inLoop = false;
    const toLoop = () => { if (!exiting) beginLoop(); };
    const afterEnter = () => {
      if (exiting) return;
      // lead：进入 loop 前先把一次性动作片段（如 feed）播一次。
      if (opts?.lead) playClip(opts.lead, toLoop);
      else toLoop();
    };
    if (b.enter) playClip(b.enter, afterEnter);
    else afterEnter();
  }

  function requestExit(onDone: () => void) {
    if (exiting) return; // 幂等：轮换与点击竞态只执行一次
    exiting = true;
    inLoop = false; // 开始退出（起身）：退出期间不再允许点击唤醒
    clearAllTimers();
    if (behavior?.exit) {
      playClip(behavior.exit, onDone);
    } else {
      clip.stop();
      onDone();
    }
  }

  function stop() {
    clearAllTimers();
    clip.stop();
    exiting = false;
    inLoop = false;
    behavior = null;
  }

  /** 是否处于可点击唤醒的点（已进入 loop 且未退出）。 */
  function canWake() {
    return inLoop;
  }

  onScopeDispose(stop);

  return { currentSrc, start, requestExit, stop, canWake, playOneShot };
}
