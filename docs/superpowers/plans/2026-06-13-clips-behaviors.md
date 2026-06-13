# 片段（Clips）+ 行为（Behaviors）重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用「片段库 + 行为库 + 播放头丝滑链」一套模型取代现有的双注册表（`ACTIONS` + `SegmentedActionDef`），让配置像剧本一样好懂，并让 sleep 的呼吸↔耳朵↔尾巴无跳帧续播。

**Architecture:** 新增 `clips.ts`（帧来源 `SOURCES` + 片段 `CLIPS` + `resolveClip`，方向藏在 range 里）和 `behaviors.ts`（`BEHAVIORS` + `IDLE_POOL`）。新增运行器 `useBehavior.ts`：enter/exit/非相邻插播用现有 `useSpriteAnimation` 离散播放；base 呼吸 + 相邻插播用「播放头」（绝对帧索引逐帧 ±1）驱动，从接缝续进、走到头再走回，全程相邻零跳。`useCatBrain` 改接 `useBehavior` + `BEHAVIORS`，删除 `segments.ts` / `useSegmentedAction.ts` / 老 `ACTIONS`。

**Tech Stack:** Vue 3.5 Composition API + TypeScript + Vite 6 + Tauri 2。

**验证方式：** 项目**无测试运行器**（见 CLAUDE.md）。每个任务以 `pnpm exec vue-tsc --noEmit`（零错误）做门禁，最后一个任务用 `pnpm build` + `pnpm app:dev` 手动观察（重点看丝滑）。

**注释约定：** `src/` 下注释一律中文、文档注释风格。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/actions/clips.ts` | `SOURCES` 帧来源映射、`Clip` 类型、`CLIPS` 片段库、`resolveClip` | 新增 |
| `src/actions/behaviors.ts` | `Behavior` 类型、`BEHAVIORS` 行为库、`IDLE_POOL` | 新增 |
| `src/composables/useBehavior.ts` | 行为播放器：离散片段（useSpriteAnimation）+ 播放头丝滑循环 | 新增 |
| `src/composables/useCatBrain.ts` | 改接 `useBehavior` + `BEHAVIORS`；`activePlayer` 简化为 gaze/beh；退休 `idleFps` | 改写 |
| `src/actions/segments.ts` | 被取代 | 删除 |
| `src/composables/useSegmentedAction.ts` | 被取代 | 删除 |
| `src/actions/index.ts` | 老 `ACTIONS`/`ActionDef`/`getAction`/`IDLE_POOL` 被 behaviors 取代 | 删除 |
| `src/composables/useSpriteAnimation.ts` | 离散片段播放器 | 不改（复用） |
| `src/actions/frames.ts` | 提供 `FRAMES`/`IDLE_FRAMES` 给 `SOURCES` | 不改 |

---

## Task 1: 片段库 `src/actions/clips.ts`

**Files:**
- Create: `src/actions/clips.ts`

- [ ] **Step 1: 创建 `src/actions/clips.ts`**

```ts
/**
 * 片段库 —— 所有「最小动画单元」的声明式定义。
 *
 * 一个片段（Clip）就是「从某个帧来源里截一段、以某 fps 播放」。方向藏在区间里：
 *   range:[a,b] 且 a <= b ：正放，帧 a..b-1
 *   range:[a,b] 且 a >  b ：倒放，帧 a-1..b（即把 [b,a) 倒过来）
 * 例：趴下 [0,190] 正放 0..189；醒来 [190,0] 倒放 189..0（＝趴下反着播）。
 *
 * 行为库（见 `./behaviors.ts`）按名字引用这些片段来编排播放。
 */
import { FRAMES, IDLE_FRAMES } from "./frames";

/** 帧来源键 → 帧 URL 数组。新增来源时在此登记。 */
export const SOURCES: Record<string, string[]> = {
  sleep: FRAMES.sleep,
  idle: IDLE_FRAMES,
  wiki: FRAMES.wiki,
};

/** 一个最小动画单元。 */
export interface Clip {
  /** 帧来源键（`SOURCES` 的键）。 */
  src: string;
  /** 帧区间 [a,b]，左闭右开；a<=b 正放，a>b 倒放（方向即播放方向）。 */
  range: [number, number];
  /** 播放速度（fps）。 */
  fps: number;
  /** yoyo 来回（正放+反放、去重端点），默认 false。 */
  yoyo?: boolean;
  /** 可读标签（调试 / 中文名）。 */
  label?: string;
}

/**
 * 把片段解析成有序的帧 URL 数组。
 * 先按方向取序列（正/倒放），再按需做 yoyo 来回拼接。
 */
export function resolveClip(clip: Clip): string[] {
  const src = SOURCES[clip.src] ?? [];
  const [a, b] = clip.range;
  let seq = a <= b ? src.slice(a, b) : src.slice(b, a).reverse();
  if (clip.yoyo && seq.length > 2) {
    seq = [...seq, ...seq.slice(1, -1).reverse()];
  }
  return seq;
}

/**
 * 片段库。端点为「大概值」，后续逐帧微调。睡觉素材是连续录像（241 帧 0..240）：
 *   趴下 0–189、呼吸 187–199、耳朵/尾巴从接缝 200 出发（耳朵到 214、尾巴走到 240）。
 */
export const CLIPS: Record<string, Clip> = {
  lieDown: { src: "sleep", range: [0, 190], fps: 36, label: "趴下" },
  wakeUp: { src: "sleep", range: [190, 0], fps: 36, label: "醒来" }, // 趴下倒放
  sleepBreathe: { src: "sleep", range: [187, 200], fps: 10, yoyo: true, label: "睡觉呼吸" },
  sleepEar: { src: "sleep", range: [200, 215], fps: 24, label: "睡觉耳朵" }, // 从接缝出发
  sleepTail: { src: "sleep", range: [200, 241], fps: 24, label: "睡觉尾巴" }, // 从接缝出发，走更远
  idleBreathe: { src: "idle", range: [0, IDLE_FRAMES.length], fps: 24, label: "空闲呼吸" },
  wiki: { src: "wiki", range: [0, FRAMES.wiki.length], fps: 24, label: "wiki" },
};
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 零错误。若报 `FRAMES.wiki` 不存在，确认 `src/actions/frames.ts` 的 `FRAMES` 含 `wiki` 键（现状：`FRAMES = { wiki, sleep }`）。

- [ ] **Step 3: 提交**

```bash
git add src/actions/clips.ts
git commit -m "feat: 新增片段库 clips.ts（SOURCES/Clip/CLIPS/resolveClip）"
```

---

## Task 2: 行为库 `src/actions/behaviors.ts`

**Files:**
- Create: `src/actions/behaviors.ts`

- [ ] **Step 1: 创建 `src/actions/behaviors.ts`**

```ts
/**
 * 行为库 —— 像剧本一样按名字引用片段（见 `./clips.ts`）。
 *
 * 一个行为（Behavior）＝ 可选的 enter（进入放一次）→ 可选的 loop（呼吸基底 + 随机插播）
 * → 可选的 exit（退出放一次）。没有 loop 的行为是「一次性动作」（放完 enter/exit 即结束）。
 * 状态机（`useCatBrain`）读取本表来决定播放与中断。
 *
 * 新增行为：在 `./clips.ts` 加好片段，然后在此加一条引用这些片段名的行为即可
 *（不必再像旧设计那样登记两遍）。
 */

/** 循环段：基底 + 随机插播。 */
export interface BehaviorLoop {
  /** 基底片段名（呼吸等环境动作）。 */
  base: string;
  /** 随机插播的片段名列表（可空＝纯基底循环）。 */
  random: string[];
  /** 两次插播之间的随机间隔 [min,max]（毫秒）。 */
  delay: [number, number];
}

/** 一个行为。 */
export interface Behavior {
  /** 进入时正放一次的片段名（可选；一次性动作只配它）。 */
  enter?: string;
  /** 环境循环（可选；纯一次性动作不配）。 */
  loop?: BehaviorLoop;
  /** 退出时正放一次的片段名（可选；如 sleep 的 wakeUp）。 */
  exit?: string;
  /** 多少毫秒后自动结束（sleep 2 分钟自动醒）；不设＝不自动结束。仅对有 loop 的行为有意义。 */
  autoEndMs?: number;
  /** 鼠标移动能否打断并切回跟随，默认 false（只能点击/自动结束）。 */
  interruptible?: boolean;
  /** 能否被空闲自动播放挑中，默认 false。 */
  idleAuto?: boolean;
}

/** 行为库。 */
export const BEHAVIORS: Record<string, Behavior> = {
  idle: {
    // idle 是「休息态」本身，不参与 idleAuto 自动挑选。
    loop: { base: "idleBreathe", random: [], delay: [6000, 14000] },
  },
  sleep: {
    enter: "lieDown",
    loop: { base: "sleepBreathe", random: ["sleepEar", "sleepTail"], delay: [3000, 7000] },
    exit: "wakeUp", // 醒来＝趴下倒放（靠片段 range 方向实现）
    autoEndMs: 120000,
    // interruptible 默认 false：睡觉不被鼠标移动打断，只能点击/2 分钟自动醒。
    idleAuto: true,
  },
  wiki: {
    enter: "wiki", // 只有 enter ＝ 一次性动作：放完即结束
    interruptible: true, // wiki 可被鼠标移动打断（覆盖默认 false）
    idleAuto: true,
  },
};

/** 空闲自动播放池：`idleAuto` 为 true 的行为名。 */
export const IDLE_POOL: string[] = Object.entries(BEHAVIORS)
  .filter(([, b]) => b.idleAuto)
  .map(([name]) => name);
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 零错误。

- [ ] **Step 3: 提交**

```bash
git add src/actions/behaviors.ts
git commit -m "feat: 新增行为库 behaviors.ts（Behavior/BEHAVIORS/IDLE_POOL）"
```

---

## Task 3: 行为播放器 `src/composables/useBehavior.ts`

**Files:**
- Create: `src/composables/useBehavior.ts`

实现要点：
- `clip`（`useSpriteAnimation`）播离散片段：enter、exit、非相邻插播。
- 播放头（`cur` 绝对帧索引）驱动 loop：base 在 `[baseLo,baseHi]` 来回摆动；相邻插播（同源且起始帧＝`baseHi+1`）从接缝续进、走到 `excHi` 再走回 `baseHi`。
- `using`（`'clip' | 'loop'`）决定 `currentSrc` 取哪一路。
- 步进器用链式 `setTimeout`（fps 随段变化）。

- [ ] **Step 1: 创建 `src/composables/useBehavior.ts`**

```ts
/**
 * useBehavior —— 行为播放器（取代 useSegmentedAction）。
 *
 * 把一个 Behavior 编排成：enter（离散放一次）→ loop（呼吸基底 + 随机插播）→ exit。
 * 循环用「播放头」（当前绝对帧索引 cur）驱动：base 在 [baseLo,baseHi] 间来回摆动；与
 * base 同源且接缝相邻（起始帧＝baseHi+1）的插播，从接缝续进、走到头再走回来 —— 全程
 * 相邻帧、无跳帧（丝滑链）。enter/exit/非相邻插播是离散片段，用通用播放器
 * useSpriteAnimation 整段播放。`using` 决定当前帧取离散播放器还是播放头。
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
  /** 开始一个行为：enter → loop（含丝滑插播）。autoEndMs 到点调用 onEnd。 */
  start(behavior: Behavior, onEnd?: () => void): void;
  /** 请求退出：有 exit 则放完再 onDone，否则立即 onDone。退出期间重复调用被忽略。 */
  requestExit(onDone: () => void): void;
  /** 硬停：清掉所有定时器与播放，不放 exit、不回调。 */
  stop(): void;
}

export function useBehavior(): BehaviorController {
  const clip = useSpriteAnimation(); // 离散片段：enter / exit / 非相邻插播
  const loopSrc = ref(""); // 播放头当前帧
  const using = ref<"clip" | "loop">("loop");

  const currentSrc = computed(() =>
    using.value === "clip" ? clip.currentSrc.value : loopSrc.value,
  );

  let behavior: Behavior | null = null;
  let onEnd: (() => void) | undefined;
  let exiting = false;

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
  let autoEndTimer: number | undefined;

  function clearStepTimer() {
    if (stepTimer !== undefined) { window.clearTimeout(stepTimer); stepTimer = undefined; }
  }
  function clearTwitchTimer() {
    if (twitchTimer !== undefined) { window.clearTimeout(twitchTimer); twitchTimer = undefined; }
  }
  function clearAutoEndTimer() {
    if (autoEndTimer !== undefined) { window.clearTimeout(autoEndTimer); autoEndTimer = undefined; }
  }
  function clearAllTimers() {
    clearStepTimer();
    clearTwitchTimer();
    clearAutoEndTimer();
  }

  /** 离散片段（enter/exit/非相邻插播）整段播放一次。 */
  function playClip(name: string, done: () => void) {
    const c = CLIPS[name];
    if (!c) { done(); return; }
    using.value = "clip";
    clip.play(resolveClip(c), { fps: c.fps, loop: false }, done);
  }

  /** 进入循环：建立播放头状态并开始呼吸 + 排期插播。 */
  function beginLoop() {
    const loop = behavior?.loop;
    if (!loop) {
      // 一次性行为（无 loop）：直接走退出（含 exit）后结束。
      requestExit(onEnd ?? (() => {}));
      return;
    }
    const base = CLIPS[loop.base];
    srcFrames = SOURCES[base.src] ?? [];
    baseLo = Math.min(base.range[0], base.range[1]);
    baseHi = Math.max(base.range[0], base.range[1]) - 1;
    baseFps = base.fps;
    twitches = loop.random.map((name) => {
      const c = CLIPS[name];
      const lo = Math.min(c.range[0], c.range[1]);
      const hi = Math.max(c.range[0], c.range[1]) - 1;
      const adjacent = c.src === base.src && lo === baseHi + 1;
      return { name, hi, fps: c.fps, adjacent, frames: adjacent ? [] : resolveClip(c) };
    });
    cur = baseLo;
    phase = "breatheUp";
    pendingAdj = null;
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
          cur = baseHi;
          phase = "breatheDown"; // 回到接缝，从尾帧继续呼吸（向下）
          scheduleNextTwitch();
        }
        break;
    }
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
      cur = baseHi; // 回到接缝（此处一次硬切，属非相邻兜底）
      phase = "breatheDown";
      using.value = "loop";
      loopSrc.value = srcFrames[cur] ?? "";
      scheduleNextTwitch();
      scheduleStep();
    });
  }

  function start(b: Behavior, end?: () => void) {
    clearAllTimers();
    clip.stop();
    behavior = b;
    onEnd = end;
    exiting = false;
    if (b.autoEndMs && b.autoEndMs > 0) {
      autoEndTimer = window.setTimeout(() => requestExit(onEnd ?? (() => {})), b.autoEndMs);
    }
    if (b.enter) {
      playClip(b.enter, () => { if (!exiting) beginLoop(); });
    } else {
      beginLoop();
    }
  }

  function requestExit(onDone: () => void) {
    if (exiting) return; // 幂等：自动结束与点击竞态只执行一次
    exiting = true;
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
    behavior = null;
  }

  onScopeDispose(stop);

  return { currentSrc, start, requestExit, stop };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 零错误。常见问题：`useSpriteAnimation.play` 的签名为 `play(frames, opts?, onDone?)`，`opts` 含 `fps`/`loop`/`loopFrom`；确认调用一致。

- [ ] **Step 3: 提交**

```bash
git add src/composables/useBehavior.ts
git commit -m "feat: 新增行为播放器 useBehavior（播放头丝滑链 + 离散片段）"
```

---

## Task 4: 改写 `src/composables/useCatBrain.ts`

**Files:**
- Modify: `src/composables/useCatBrain.ts`（整文件替换为下方内容）

把帧来源播放器从 `anim`+`seg` 收敛为单个 `beh = useBehavior()`；`activePlayer` 简化为 `'gaze' | 'beh'`；`trigger` 单路解析 `BEHAVIORS[name]`；删除 `idleFps`（idle 速度改由 `idleBreathe` 片段的 fps 决定）。

- [ ] **Step 1: 用以下完整内容替换整个 `src/composables/useCatBrain.ts`**

```ts
/**
 * useCatBrain —— 猫的行为状态机。
 *
 * 这里是"猫此刻应该显示哪一帧"的唯一权威来源。它持有一个显式的状态机和一个
 * 约 20fps 的 tick 循环，并组合了两个更底层的行为：
 *   - useGaze       (跟随光标，由角度驱动)
 *   - useBehavior   (按「片段+行为」编排播放，含丝滑链)
 *
 * 状态
 *   idle    : 休息。经过一段随机延迟后，会自动播放 IDLE_POOL 中的某个行为。
 *   follow  : 跟踪光标(注视)。
 *   action  : 播放一个被触发的行为(wiki、sleep 等)。
 *
 * 状态转换
 *   任意非 action 状态 + 鼠标移动        → follow
 *   follow + 鼠标静止超过 idleTimeoutMs   → idle
 *   idle  + 随机定时器触发                → action(取自 IDLE_POOL)→ idle
 *   trigger(name)                        → action，结束后 → follow 或 idle
 *   action(可打断) + 鼠标移动            → follow
 *
 * 预留接口：`trigger(name, resume?)`、后端 `pet-play-action` 事件转发到 `trigger`、
 * 可变 `config`。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BEHAVIORS, IDLE_POOL } from "../actions/behaviors";
import { useGaze } from "./useGaze";
import { useBehavior } from "./useBehavior";

/** Rust 端 `pet_cursor_angle` 命令返回的注视采样数据。 */
interface GazeSample {
  angle: number | null;
  cursor_x: number;
  cursor_y: number;
  over_cat: boolean;
}

export type CatStateKind = "idle" | "follow" | "action";

export interface CatState {
  kind: CatStateKind;
  /** 仅当 kind === "action" 时存在。 */
  action?: string;
}

export interface BrainConfig {
  /** tick 间隔(毫秒，即注视采样频率)。 */
  tickMs: number;
  /** 光标位移(物理像素)超过该阈值时，才判定鼠标"移动了"。 */
  moveThreshold: number;
  /** 跟随状态下，光标静止超过这段时间(毫秒)后切回 idle。 */
  idleTimeoutMs: number;
  /** idle 自动播放动作前的随机延迟区间 [min, max](毫秒)。 */
  idleActionDelay: [number, number];
  /** 可用于 idle 自动播放的行为名列表。为空 = 仅循环 idle。 */
  idlePool: string[];
}

export const DEFAULT_CONFIG: BrainConfig = {
  tickMs: 50,
  moveThreshold: 2,
  idleTimeoutMs: 5000,
  idleActionDelay: [6000, 14000],
  idlePool: IDLE_POOL,
};

export interface BrainOptions {
  /** 获取是否启用光标跟随("别偷看"开关)。 */
  followEnabled: () => boolean;
  /**
   * 获取大脑是否被冻结。为 true 时猫被保持在 idle：忽略光标、抑制 idle 自动播放，
   * 因此头部保持不动。用于头部校准期间。默认：始终为 false。
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
  /**
   * 播放一个行为，覆盖当前任何行为。结束后回到 `resume`(若跟随开启则 "follow"，否则
   * "idle")。当行为名未知时为空操作。
   */
  trigger: (name: string, resume?: "follow" | "idle") => void;
  /** 立即把猫从当前动作中唤醒。若当前不在 action 中则为空操作。 */
  wake: () => void;
}

export function useCatBrain(opts: BrainOptions): CatBrain {
  const config: BrainConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const gaze = useGaze();
  const beh = useBehavior(); // idle 与所有被触发的行为都走它

  const state = ref<CatState>({ kind: "idle" });
  const cursorOverCat = ref(false);

  /** 当前帧来源：gaze(注视) / beh(行为播放器)。 */
  const activePlayer = ref<"gaze" | "beh">("beh");

  const currentSrc = computed(() =>
    activePlayer.value === "gaze" ? gaze.currentSrc.value : beh.currentSrc.value,
  );

  let lastPos: { x: number; y: number } | null = null;
  let lastMoveAt = 0;
  let tickTimer: number | undefined;
  let idleActionTimer: number | undefined;
  // 被触发的循环行为(sleep)唤醒后要返回的状态。
  let actionResume: "follow" | "idle" = "follow";
  let unlisten: UnlistenFn | undefined;

  function clearIdleActionTimer() {
    if (idleActionTimer !== undefined) {
      window.clearTimeout(idleActionTimer);
      idleActionTimer = undefined;
    }
  }

  function scheduleIdleAction() {
    clearIdleActionTimer();
    if (config.idlePool.length === 0) return;
    const [lo, hi] = config.idleActionDelay;
    const delay = lo + Math.random() * Math.max(0, hi - lo);
    idleActionTimer = window.setTimeout(() => {
      if (state.value.kind !== "idle") return;
      // 冻结期间被抑制 —— 重新排期，以便在校准结束后恢复。
      if (opts.paused?.()) {
        scheduleIdleAction();
        return;
      }
      const pool = config.idlePool;
      const name = pool[Math.floor(Math.random() * pool.length)];
      trigger(name, "idle");
    }, delay);
  }

  function enterIdle() {
    clearIdleActionTimer();
    activePlayer.value = "beh";
    state.value = { kind: "idle" };
    // idle 是「休息态」本身：播放 idle 行为(整段呼吸循环)。
    beh.start(BEHAVIORS.idle);
    scheduleIdleAction();
  }

  function enterFollow() {
    clearIdleActionTimer();
    // 跟随期间由注视驱动帧，停掉行为播放器。
    beh.stop();
    activePlayer.value = "gaze";
    state.value = { kind: "follow" };
  }

  /** 结束当前动作，回到恢复目标(follow / idle)。 */
  function finishAction() {
    if (actionResume === "follow" && opts.followEnabled()) enterFollow();
    else enterIdle();
  }

  /**
   * 立即把猫从当前动作中唤醒(例如 sleep 期间的一次点击)。先放该行为的 exit
   * (sleep 的醒来＝趴下倒放)再 finishAction。若当前不在 action 中则为空操作。
   */
  function wake() {
    if (state.value.kind !== "action") return;
    beh.requestExit(finishAction);
  }

  function trigger(name: string, resume: "follow" | "idle" = "follow") {
    const b = BEHAVIORS[name];
    if (!b) return; // 未知行为名：空操作
    clearIdleActionTimer();
    actionResume = resume;
    activePlayer.value = "beh";
    state.value = { kind: "action", action: name };
    // autoEndMs 到点用 finishAction 自动结束(sleep 2 分钟自动醒)。
    beh.start(b, finishAction);
  }

  async function tick() {
    let sample: GazeSample;
    try {
      sample = await invoke<GazeSample>("pet_cursor_angle");
    } catch {
      return; // 销毁期间的瞬时 IPC 错误
    }

    // 发布光标是否悬停在猫上(用于驱动点击穿透)。无条件设置以保持实时。
    cursorOverCat.value = sample.over_cat;

    // 根据原始的全局光标位置进行移动检测。
    let moved = false;
    const pos = { x: sample.cursor_x, y: sample.cursor_y };
    if (lastPos) {
      moved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > config.moveThreshold;
    }
    lastPos = pos;
    if (moved) lastMoveAt = Date.now();

    // 冻结状态(头部校准期间):保持 idle，忽略光标。
    if (opts.paused?.()) {
      if (state.value.kind !== "idle") enterIdle();
      return;
    }

    const following = opts.followEnabled();

    switch (state.value.kind) {
      case "action": {
        // 仅 interruptible 显式为 true 的行为(wiki)在鼠标移动时切回 follow。
        const b = BEHAVIORS[state.value.action ?? ""];
        if (b?.interruptible === true && moved && following) {
          enterFollow();
        }
        return;
      }
      case "idle": {
        if (moved && following) enterFollow();
        return;
      }
      case "follow": {
        if (!following || Date.now() - lastMoveAt > config.idleTimeoutMs) {
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
    enterIdle();
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
    clearIdleActionTimer();
    beh.stop();
    unlisten?.();
  });

  return { state, currentSrc, cursorOverCat, config, trigger, wake };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 此时**仍会**因为 `src/actions/segments.ts` 与 `src/composables/useSegmentedAction.ts` 还在、但已无人引用而通过（它们是孤立文件，不报错）。零错误。若报错通常是本文件里残留的旧引用 —— 确认已删除对 `ACTIONS`/`FRAMES`/`seg`/`anim`/`idleFps` 的所有引用。

- [ ] **Step 3: 提交**

```bash
git add src/composables/useCatBrain.ts
git commit -m "feat: useCatBrain 改接 useBehavior + BEHAVIORS（单一行为播放器）"
```

---

## Task 5: 删除旧文件并清理

**Files:**
- Delete: `src/actions/segments.ts`
- Delete: `src/composables/useSegmentedAction.ts`
- Delete: `src/actions/index.ts`
- Modify: `src/actions/frames.ts`（更新一处过时注释）

- [ ] **Step 1: 确认无残留引用**

Run: `git grep -n "actions/segments\|useSegmentedAction\|from \"\.\./actions\"\|from \"\./index\"\|SEGMENTED_ACTIONS\|getAction\|ActionDef" -- src/`
Expected: 仅可能命中将要删除的文件自身。若命中其它 `src/` 文件（除注释外），先改这些引用再删。

- [ ] **Step 2: 删除被取代的文件**

```bash
git rm src/actions/segments.ts src/composables/useSegmentedAction.ts src/actions/index.ts
```

> 说明：`src/actions/index.ts` 里的 `ACTIONS`/`ActionDef`/`getAction`/`IDLE_POOL` 已被 `behaviors.ts` 取代，且除 `useCatBrain`（已在 Task 4 改为从 `behaviors.ts` 导入）外无其它消费者。

- [ ] **Step 3: 更新 `src/actions/frames.ts` 的过时注释**

打开 `src/actions/frames.ts`，把第 57 行附近这条注释：
```ts
/** 动作名称 → 有序的帧 URL。键必须与 `./index.ts` 中的 `ACTIONS` 一致。 */
```
改为：
```ts
/** 动作帧来源 → 有序的帧 URL。键由 `./clips.ts` 的 `SOURCES` 引用（如 sleep、wiki）。 */
```

- [ ] **Step 4: 完整构建（含类型检查 + 打包）**

Run: `pnpm build`
Expected: `vue-tsc --noEmit` 零错误，vite 打包成功（`✓ built`）。若报「找不到模块 ../actions」或 `index`，说明仍有文件 import 了已删的 `src/actions/index.ts` —— 按 Step 1 排查。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 删除旧的 segments/useSegmentedAction/index（被 clips+behaviors 取代）"
```

---

## Task 6: 手动验证与微调

**Files:**
- 视观察可能微调：`src/actions/clips.ts`（区间 / fps / yoyo）、`src/actions/behaviors.ts`（delay）

- [ ] **Step 1: 启动应用**

Run: `pnpm app:dev`
Expected: 窗口出现，猫正常显示并能跟随光标。

- [ ] **Step 2: 逐项观察**

1. 触发睡觉 → 猫**趴下**(lieDown 正放一次，约 5s @36fps)。
2. 熟睡：**安静呼吸**为底(sleepBreathe，约 3s 一循环 @10fps)，每 3–7s 随机**动耳朵**或**摇尾巴**。
3. **重点验证丝滑**：呼吸→耳朵→呼吸、呼吸→尾巴→呼吸之间**无可见跳帧**(播放头沿原视频相邻帧走)。
4. **点击猫** → **起身**(wakeUp＝lieDown 倒放)后回 follow/idle。
5. 睡觉时**移动鼠标不唤醒**(interruptible 默认 false)。
6. 静置 **2 分钟** → 自动起身(autoEndMs)。
7. 普通 **idle** 行为与改动前一致(cat-idla 整段循环)；若 idle 自动选中 **wiki** 则正常一次性播放并结束。

- [ ] **Step 3: 按需微调（可选）**

仅改 `src/actions/clips.ts` 的片段区间/fps/yoyo，或 `src/actions/behaviors.ts` 的 `delay`。改完重跑 `pnpm app:dev` 观察。

- [ ] **Step 4: 提交微调（若有）**

```bash
git add src/actions/clips.ts src/actions/behaviors.ts
git commit -m "tune: 微调睡觉片段区间/速度/间隔"
```

---

## Self-Review

**1. 规格覆盖**
- 一套模型(片段+行为) → Task 1、2 ✅
- range 方向编码正/倒放、`resolveClip` → Task 1 ✅
- wakeUp＝lieDown 倒放、exit 只写名字 → Task 1（`wakeUp:[190,0]`）+ Task 2（`exit:'wakeUp'`）✅
- 干掉双注册表、sleep 一条、wiki 统一进来、`interruptible` 默认 false → Task 2 + Task 4 ✅
- 丝滑链(播放头、接缝相邻判定、出去-回来、非相邻兜底) → Task 3 ✅
- 与 useCatBrain 整合(单 beh、activePlayer gaze/beh、单路 trigger、wake=requestExit、tick interruptible===true、IDLE_POOL、pet-play-action、卸载) → Task 4 ✅
- 删除 segments/useSegmentedAction/旧 ACTIONS → Task 5 ✅
- 不改 useSpriteAnimation、复用为离散播放器 → Task 3 ✅
- 边界(退出竞态幂等 `exiting`、接缝出发时机、差一 `baseHi=max-1`/相邻=`baseHi+1`) → Task 3 ✅

**2. 占位符扫描**：无 TBD/TODO；所有步骤含完整代码与确切命令。区间为用户要求的「大概值」且有 Task 6 微调兜底，非占位符。

**3. 类型一致性**：`Clip`/`Behavior`/`BehaviorLoop`（Task 1/2 定义）与 Task 3/4 的 `import type` 一致；`useBehavior` 对外 `start(behavior,onEnd?)`/`requestExit(onDone)`/`stop()`/`currentSrc` 与 Task 4 调用点一致；`CLIPS`/`SOURCES`/`resolveClip`/`BEHAVIORS`/`IDLE_POOL` 命名在各 Task 间一致；`activePlayer` 二态 `'gaze'|'beh'` 在 currentSrc 与状态切换处一致；`useSpriteAnimation.play(frames,opts,onDone)` 签名与 Task 3 调用一致。
