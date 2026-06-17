# 行为轮换模型重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"特例式"的 idleAuto/autoEndMs 换成统一的「加权轮换 + 转场 + 一次性动作」模型：行为（idle/sleep）平级、按 weight/duration 随机轮换，跨行为切换走 exit→enter；feed/wink 作为归属 idle 的一次性动作（ACTIONS）。

**Architecture:** `behaviors.ts` 重定义 `Behavior`（加 weight/duration，去 idleAuto/autoEndMs）+ 新增 `ACTIONS` 表。`useBehavior.ts` 的 `start` 改为 `start(behavior, {lead?})`（enter→lead→loop），去掉 autoEndMs。`useCatBrain.ts` 重写成 `behavior|follow` 两态 + `currentBehavior` + 加权轮换定时器 + `goToBehavior` 转场串联（`requestExit→start`）+ `trigger` 双查 BEHAVIORS/ACTIONS + `canWake`。`Pet.vue` 改触发调用与点击手势判定。

**Tech Stack:** Vue 3.5 Composition API + TypeScript + Vite 6 + Tauri 2。

**验证方式：** 项目无测试运行器（CLAUDE.md）。门禁＝`pnpm build`（含 `vue-tsc --noEmit`）+ `pnpm app:dev` 手动观察。

**注释约定：** `src/` 注释一律中文、文档注释风格。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/actions/behaviors.ts` | `Behavior`/`BehaviorLoop`/`ActionDef` 类型、`BEHAVIORS`、`ACTIONS` | 重写 |
| `src/composables/useBehavior.ts` | 行为播放器：`start(behavior,{lead})`、enter→lead→loop、去 autoEndMs | 改写 |
| `src/composables/useCatBrain.ts` | 状态机：behavior/follow、currentBehavior、加权轮换、转场、trigger、wake/canWake | 重写 |
| `src/components/Pet/Pet.vue` | `trigger("sleep")`/`trigger("feed")`、点击手势用 `brain.canWake()` | 改 3 处 |
| `src/actions/clips.ts` | feed/wink/idle 片段已在 | 不改 |

> 这 4 个文件是**一次原子契约变更**（类型/签名互相依赖，中间态不编译），故合并为一个任务，结尾统一 `pnpm build`。

---

## Task 1: 重写行为轮换模型（4 文件）

**Files:**
- Rewrite: `src/actions/behaviors.ts`
- Rewrite: `src/composables/useBehavior.ts`
- Rewrite: `src/composables/useCatBrain.ts`
- Modify: `src/components/Pet/Pet.vue`（3 处）

- [ ] **Step 1: 用以下完整内容替换 `src/actions/behaviors.ts`**

```ts
/**
 * 行为库 + 动作库 —— 像剧本一样按名字引用片段（见 ./clips.ts）。
 *
 * 行为（Behavior）＝ 自治、可循环的状态：idle / sleep /（将来 walk）。每个有
 * enter?/loop/exit?，以及参与「加权轮换」的 weight 与 duration。useCatBrain 按 weight
 * 随机在行为间轮换，跨行为切换播离开者的 exit、进入者的 enter。
 *
 * 动作（Action）＝ 手动触发的一次性动作：feed / wink。每个归属一个行为(home)，触发时
 * 切到该行为并把指定片段(clip)播一次，然后留在该行为的 loop 里。
 */

/** 循环段：基底 + 随机插播。 */
export interface BehaviorLoop {
  /** 基底片段名（呼吸等环境动作）。 */
  base: string;
  /** 随机插播片段名列表（可空＝纯基底循环）。 */
  random: string[];
  /** 两次插播之间的随机间隔 [min,max]（毫秒）。 */
  delay: [number, number];
}

/** 一个自治行为。 */
export interface Behavior {
  /** 进入时正放一次的片段名（sleep: lieDown；idle: 无）。 */
  enter?: string;
  /** 环境循环（自治行为必有，轮换期间持续播放）。 */
  loop: BehaviorLoop;
  /** 离开时正放一次的片段名（sleep: wakeUp；idle: 无）。 */
  exit?: string;
  /** 加权轮换被选中的相对权重（idle 高、sleep 低）。 */
  weight: number;
  /** 本行为持续多久(ms)后触发下一次轮换，随机区间 [min,max]。 */
  duration: [number, number];
  /** 鼠标移动能否抢占进 follow，默认 false。 */
  interruptible?: boolean;
}

/** 一个手动一次性动作。 */
export interface ActionDef {
  /** 归属行为名。 */
  home: string;
  /** 触发时要播放的片段名。 */
  clip: string;
}

/** 行为库（参与加权轮换）。 */
export const BEHAVIORS: Record<string, Behavior> = {
  idle: {
    // 呼吸为底，待机时随机眨眼/摇尾巴/动耳朵/吃一下/wink 一下。
    loop: {
      base: "idleBreathe",
      random: ["idleBlink", "idleTail", "idleEar", "feed", "wink"],
      delay: [5000, 11000],
    },
    weight: 10, // 大部分时间待机
    duration: [15000, 40000],
    interruptible: true, // 鼠标移动可抢占进 follow
  },
  sleep: {
    enter: "lieDown",
    loop: { base: "sleepBreathe", random: ["sleepEar", "sleepTail"], delay: [3000, 7000] },
    exit: "wakeUp", // 醒来＝趴下倒放（靠片段 range 方向实现）
    weight: 2, // 偶尔睡
    duration: [60000, 120000], // 睡 1–2 分钟（取代旧的 autoEndMs）
    // interruptible 默认 false：睡觉不被鼠标移动打断，只能点击/时长到。
  },
  // walk: 将来加，需 cat-walk 素材。
};

/** 动作库（手动触发的一次性动作）。 */
export const ACTIONS: Record<string, ActionDef> = {
  feed: { home: "idle", clip: "feed" },
  wink: { home: "idle", clip: "wink" },
};
```

- [ ] **Step 2: 用以下完整内容替换 `src/composables/useBehavior.ts`**

```ts
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
      .map((name) => CLIPS[name] ? { name, clip: CLIPS[name] } : null)
      .filter((x): x is { name: string; clip: typeof CLIPS[string] } => x !== null)
      .map(({ name, clip: c }) => {
        const lo = Math.min(c.range[0], c.range[1]);
        const hi = Math.max(c.range[0], c.range[1]) - 1;
        const adjacent = c.src === base.src && lo === baseHi + 1;
        // 相邻插播走播放头「出去再回来」本身就是 yoyo，故忽略其 yoyo 标志、也不预切帧；
        // 非相邻插播才离散播放（此时才用其 yoyo，由 resolveClip 处理）。
        return { name, hi, fps: c.fps, adjacent, frames: adjacent ? [] : resolveClip(c) };
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

  /** 排期下一次随机插播。 */
  function scheduleNextTwitch() {
    clearTwitchTimer();
    const loop = behavior?.loop;
    if (!loop || loop.random.length === 0) return;
    const [lo, hi] = loop.delay;
    const delay = lo + Math.random() * Math.max(0, hi - lo);
    twitchTimer = window.setTimeout(() => {
      if (exiting) return;
      const idx = Math.floor(Math.random() * twitches.length);
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

  return { currentSrc, start, requestExit, stop, canWake };
}
```

- [ ] **Step 3: 用以下完整内容替换 `src/composables/useCatBrain.ts`**

```ts
/**
 * useCatBrain —— 猫的行为状态机。
 *
 * 组合 useGaze（光标跟随）与 useBehavior（片段+行为播放）。
 *
 * 状态：
 *   behavior : 正在运行某个自治行为（idle/sleep…），currentBehavior 记录是哪个。
 *   follow   : 跟随光标。
 *
 * 加权轮换：每个行为有 weight + duration；进入某行为后按其 duration 排定时器，到点按
 * weight 加权随机挑下一个行为，跨行为切换播离开者 exit→进入者 enter。idle 权重高、sleep 低，
 * 所以大部分时间待机、偶尔睡。follow 是抢占层（看 interruptible），期间暂停轮换。
 *
 * 触发：trigger(name) 先查行为（切过去待着）、再查动作（切到归属行为、播一次动作片段、留下）。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BEHAVIORS, ACTIONS } from "../actions/behaviors";
import { useGaze } from "./useGaze";
import { useBehavior } from "./useBehavior";

/** Rust 端 `pet_cursor_angle` 命令返回的注视采样数据。 */
interface GazeSample {
  angle: number | null;
  cursor_x: number;
  cursor_y: number;
  over_cat: boolean;
}

export type CatStateKind = "behavior" | "follow";

export interface CatState {
  kind: CatStateKind;
  /** 仅当 kind === "behavior" 时存在：当前行为名。 */
  behavior?: string;
}

export interface BrainConfig {
  /** tick 间隔(毫秒，即注视采样频率)。 */
  tickMs: number;
  /** 光标位移(物理像素)超过该阈值时，才判定鼠标"移动了"。 */
  moveThreshold: number;
  /** 跟随状态下，光标静止超过这段时间(毫秒)后切回 idle。 */
  idleTimeoutMs: number;
}

export const DEFAULT_CONFIG: BrainConfig = {
  tickMs: 50,
  moveThreshold: 2,
  idleTimeoutMs: 5000,
};

export interface BrainOptions {
  /** 获取是否启用光标跟随("别偷看"开关)。 */
  followEnabled: () => boolean;
  /**
   * 获取大脑是否被冻结。为 true 时保持 idle：忽略光标、暂停轮换。用于头部校准期间。
   * 默认：始终为 false。
   */
  paused?: () => boolean;
  /** 合并到 DEFAULT_CONFIG 上的部分覆盖项。 */
  config?: Partial<BrainConfig>;
}

export interface CatBrain {
  /** 当前的状态机状态(只读视图)。 */
  state: Ref<CatState>;
  /** 此刻要显示的帧 URL。把它绑定到 <CatSprite :src>。 */
  currentSrc: Ref<string>;
  /** 全局光标当前是否悬停在猫的精灵图上(由注视轮询驱动，用于点击穿透)。 */
  cursorOverCat: Ref<boolean>;
  /** 实时可变的行为配置。 */
  config: BrainConfig;
  /** 触发一个行为名或动作名（菜单/后端事件）。未知名为空操作。 */
  trigger: (name: string) => void;
  /** 点击唤醒：若当前行为有 exit 且已进 loop，则起身回 idle。否则空操作。 */
  wake: () => void;
  /** 当前点击是否会唤醒（供 Pet.vue 决定点击手势）。 */
  canWake: () => boolean;
}

export function useCatBrain(opts: BrainOptions): CatBrain {
  const config: BrainConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const gaze = useGaze();
  const beh = useBehavior();

  const state = ref<CatState>({ kind: "behavior", behavior: "idle" });
  const cursorOverCat = ref(false);
  let currentBehavior = "idle";

  /** 当前帧来源：gaze(注视) / beh(行为播放器)。 */
  const activePlayer = ref<"gaze" | "beh">("beh");
  const currentSrc = computed(() =>
    activePlayer.value === "gaze" ? gaze.currentSrc.value : beh.currentSrc.value,
  );

  let lastPos: { x: number; y: number } | null = null;
  let lastMoveAt = 0;
  let tickTimer: number | undefined;
  let rotationTimer: number | undefined;
  let unlisten: UnlistenFn | undefined;

  function clearRotationTimer() {
    if (rotationTimer !== undefined) {
      window.clearTimeout(rotationTimer);
      rotationTimer = undefined;
    }
  }

  /** 进入某行为后，按其 duration 排下一次轮换。 */
  function scheduleRotation() {
    clearRotationTimer();
    const b = BEHAVIORS[currentBehavior];
    if (!b) return;
    const [lo, hi] = b.duration;
    const delay = lo + Math.random() * Math.max(0, hi - lo);
    rotationTimer = window.setTimeout(() => {
      if (state.value.kind !== "behavior") return; // follow 期间不轮换
      if (opts.paused?.()) { scheduleRotation(); return; } // 校准期间抑制，稍后重排
      rotate();
    }, delay);
  }

  /** 按 weight 加权随机挑一个行为名。 */
  function pickWeightedBehavior(): string {
    const names = Object.keys(BEHAVIORS);
    const weights = names.map((n) => BEHAVIORS[n].weight);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < names.length; i++) {
      r -= weights[i];
      if (r < 0) return names[i];
    }
    return names[names.length - 1];
  }

  function rotate() {
    const next = pickWeightedBehavior();
    if (next === currentBehavior) {
      scheduleRotation(); // 重选到自己：继续待着，重排定时器
      return;
    }
    goToBehavior(next);
  }

  /**
   * 切到某行为：若当前在行为态则先播其 exit，再进入 name（enter→lead?→loop）。
   * 从 follow 来则不走 exit（抢占层无转场）。
   */
  function goToBehavior(name: string, lead?: string) {
    const b = BEHAVIORS[name];
    if (!b) return;
    clearRotationTimer();
    const enter = () => {
      currentBehavior = name;
      activePlayer.value = "beh";
      state.value = { kind: "behavior", behavior: name };
      beh.start(b, lead ? { lead } : undefined);
      scheduleRotation();
    };
    if (state.value.kind === "behavior") {
      beh.requestExit(enter); // 播离开者 exit（idle 无 exit→立即）→ 进入
    } else {
      beh.stop(); // 从 follow 来：直接进
      enter();
    }
  }

  function enterFollow() {
    clearRotationTimer();
    beh.stop();
    activePlayer.value = "gaze";
    state.value = { kind: "follow" };
  }

  function enterIdle() {
    goToBehavior("idle");
  }

  function trigger(name: string) {
    if (BEHAVIORS[name]) {
      goToBehavior(name); // 行为：切过去待着
      return;
    }
    const a = ACTIONS[name];
    if (a) {
      goToBehavior(a.home, a.clip); // 动作：切到归属行为，把动作片段当 lead 播一次
      return;
    }
    // 未知名：空操作
  }

  /** 点击是否会唤醒：当前行为有 exit 且已进 loop。 */
  function canWake() {
    if (state.value.kind !== "behavior") return false;
    return !!BEHAVIORS[currentBehavior]?.exit && beh.canWake();
  }

  function wake() {
    if (!canWake()) return;
    goToBehavior("idle"); // 播当前 exit（如 wakeUp 起身）→ idle
  }

  async function tick() {
    let sample: GazeSample;
    try {
      sample = await invoke<GazeSample>("pet_cursor_angle");
    } catch {
      return; // 销毁期间的瞬时 IPC 错误
    }

    cursorOverCat.value = sample.over_cat;

    let moved = false;
    const pos = { x: sample.cursor_x, y: sample.cursor_y };
    if (lastPos) {
      moved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > config.moveThreshold;
    }
    lastPos = pos;
    if (moved) lastMoveAt = Date.now();

    // 校准期间：保持 idle、暂停轮换、忽略光标。
    if (opts.paused?.()) {
      if (state.value.kind !== "behavior" || currentBehavior !== "idle") enterIdle();
      return;
    }

    const following = opts.followEnabled();

    switch (state.value.kind) {
      case "behavior": {
        const b = BEHAVIORS[currentBehavior];
        // 仅当前行为可打断（idle）+ 鼠标移动 + 光标在死区外，才抢占进 follow。
        if (b?.interruptible === true && moved && following && sample.angle !== null) {
          enterFollow();
        }
        return;
      }
      case "follow": {
        // 不跟随 / 静止超时 / 光标进入头部死区 → 回 idle。
        if (!following || Date.now() - lastMoveAt > config.idleTimeoutMs || sample.angle === null) {
          enterIdle();
          return;
        }
        gaze.update(sample.angle);
        return;
      }
    }
  }

  onMounted(async () => {
    lastMoveAt = Date.now();
    // 起步：直接进入 idle 行为（无需转场）。
    currentBehavior = "idle";
    activePlayer.value = "beh";
    state.value = { kind: "behavior", behavior: "idle" };
    beh.start(BEHAVIORS.idle);
    scheduleRotation();
    tickTimer = window.setInterval(tick, config.tickMs);
    void tick();
    try {
      unlisten = await listen<string>("pet-play-action", (e) => {
        if (typeof e.payload === "string") trigger(e.payload);
      });
    } catch {
      // 事件绑定不可用(例如销毁期间)—— 忽略。
    }
  });

  onUnmounted(() => {
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    clearRotationTimer();
    beh.stop();
    unlisten?.();
  });

  return { state, currentSrc, cursorOverCat, config, trigger, wake, canWake };
}
```

- [ ] **Step 4: 改 `src/components/Pet/Pet.vue` 的 3 处**

4a. `onSleep` 去掉 resume 参数：
```ts
function onSleep() {
  menuOpen.value = false;
  brain.trigger("sleep");
}
```

4b. `onFeed` 去掉 resume 参数（注释保留语义）：
```ts
function onFeed() {
  menuOpen.value = false;
  // 投喂＝切到 idle 并播一次 feed；睡觉时会先起床再吃，吃完留在 idle。
  brain.trigger("feed");
}
```

4c. `onMouseDown` 里把 `brain.state.value.kind === "action"` 改为 `brain.canWake()`：
```ts
async function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  // 当前点击会唤醒猫（睡觉中且已熟睡）时：点击唤醒、拖动则移动它。
  if (brain.canWake()) {
    beginActionGesture(e);
    return;
  }
```
（仅替换该 `if` 条件，函数其余不变。）

- [ ] **Step 5: 完整构建（类型检查 + 打包）**

Run: `pnpm build`
Expected: `vue-tsc --noEmit` 零错误，vite `✓ built`。常见报错排查：
- `IDLE_POOL`/`idleActionDelay`/`idlePool` 仍被引用 → 已从 behaviors/brain 移除，确认无残留。
- Pet.vue 仍向 `trigger` 传第二个参数 → 改成单参（Step 4a/4b）。
- `brain.state.value.kind === "action"` 残留 → 改成 `brain.canWake()`（Step 4c）。

- [ ] **Step 6: 提交**

```bash
git add src/actions/behaviors.ts src/composables/useBehavior.ts src/composables/useCatBrain.ts src/components/Pet/Pet.vue
git commit -m "feat: 行为轮换模型（加权轮换+转场+ACTIONS，取代 idleAuto/autoEndMs）"
```

---

## Task 2: 手动验证与微调

**Files:**
- 视观察可能微调：`src/actions/behaviors.ts`（weight/duration/delay）、`src/actions/clips.ts`（片段区间/fps）

- [ ] **Step 1: 启动**

Run: `pnpm app:dev`
Expected: 窗口出现，猫默认 idle 呼吸、能跟随光标。

- [ ] **Step 2: 逐项观察**

1. **待机**：大部分时间 idle（呼吸 + 偶尔眨眼/摇尾巴/动耳朵/吃/wink）。
2. **自动轮换**：偶尔自动进入 sleep（趴下→熟睡→1–2 分钟后起身→回 idle/轮换）。idle 停留约 15–40 秒区间。
3. **菜单睡觉**：点「😴 睡觉」→ 趴下→熟睡。
4. **菜单投喂**：点「🍗 投喂」→ 若在睡觉**先起床(wakeUp)再吃(feed)**、吃完留 idle；若在 idle 直接吃。
5. **follow 抢占**：鼠标在死区外移动 → 跟随；**睡觉时移动鼠标不打断**；光标进头部死区 → 回 idle。
6. **点击唤醒**：睡熟时点击猫 → 起身回 idle；趴下中/起身中点击不唤醒；idle 时点击不触发唤醒手势（双击仍最小化、拖动仍移动窗口）。

- [ ] **Step 3: 按需微调（可选）**

仅改 `src/actions/behaviors.ts` 的 `weight`/`duration`/`delay`（轮换手感）或 `src/actions/clips.ts` 的片段区间/fps。改完重跑 `pnpm app:dev`。

- [ ] **Step 4: 提交微调（若有）**

```bash
git add src/actions/behaviors.ts src/actions/clips.ts
git commit -m "tune: 调整行为权重/时长/片段参数"
```

---

## Self-Review

**1. 规格覆盖**
- Behavior 加 weight/duration、去 idleAuto/autoEndMs；ACTIONS 表 → Task1 Step1 ✅
- 加权轮换（pickWeighted + scheduleRotation + rotate，重选到自己则待着）→ Task1 Step3 ✅
- 跨行为转场 exit→enter（goToBehavior 用 requestExit→start 串联）→ Task1 Step3 ✅
- 一次性动作 lead（enter→lead→loop）→ Task1 Step2 `start` + Step3 `trigger`/`goToBehavior` ✅
- follow 抢占层、看 interruptible、死区外才抢、回 idle → Task1 Step3 tick ✅
- 点击唤醒：有 exit 且 canWake 才生效、回 idle；canWake 暴露给 Pet.vue → Task1 Step3 wake/canWake + Step4c ✅
- 状态机 behavior|follow + currentBehavior → Task1 Step3 ✅
- 引擎去 autoEndMs、start 加 lead → Task1 Step2 ✅
- 菜单 trigger 单参、pet-play-action 转发 → Task1 Step3/Step4 ✅
- BrainConfig 去 idlePool/idleActionDelay、留 tickMs/moveThreshold/idleTimeoutMs → Task1 Step3 ✅
- 校准 paused 保持 idle、暂停轮换 → Task1 Step3 ✅

**2. 占位符扫描**：无 TBD/TODO；每步含完整代码与确切命令。weight/duration/区间为「大概值」、有 Task2 微调兜底，非占位符。

**3. 类型一致性**：`Behavior`（loop 必填、weight/duration、无 autoEndMs/idleAuto）与 useBehavior（用 enter/loop/exit）、useCatBrain（用 weight/duration/interruptible）一致；`BehaviorController.start(behavior, {lead?})` 与 brain `beh.start(b, lead?{lead})` 调用一致；`CatBrain.trigger(name)` 单参、`canWake()`、`wake()` 与 Pet.vue 调用（`trigger("sleep")`/`trigger("feed")`/`canWake()`/`wake()`）一致；`ACTIONS`/`BEHAVIORS` 命名跨文件一致；移除的 `IDLE_POOL` 无残留引用。
</content>
