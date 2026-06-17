# 通用「分段动作」机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把睡觉做成「趴下 → 安静呼吸为基底、每隔几秒随机插播动耳朵/摇尾巴 → 起床（倒放趴下过程）」，并抽出一套 sleep 与 idle 共用的通用「分段动作」机制。

**Architecture:** 新增声明式配置 `src/actions/segments.ts`（段区间常量 + 类型 + sleep/idle 配置）和通用运行器 `src/composables/useSegmentedAction.ts`（intro → base 循环 → 随机 twitch → outro 的阶段状态机）。运行器底层仍只用现有 `useSpriteAnimation`，靠喂「切片 / yoyo 拼接 / 倒序」的帧数组实现，**不改通用播放器**。`useCatBrain` 让 idle 与 sleep 走运行器，wink 等一次性动作保持原路径。

**Tech Stack:** Vue 3.5 Composition API + TypeScript + Vite 6 + Tauri 2。

**验证方式（重要）：** 本项目**无测试运行器 / linter / CI**（见 CLAUDE.md），spec 已确认验证方式为：`pnpm build`（含 `vue-tsc --noEmit` 类型检查）做静态门禁 + `pnpm app:dev` 手动观察行为。因此本计划每个任务以「类型检查通过 + 必要时手动观察 + 提交」收尾，而非自动化单测。

**代码注释约定：** `src/` 下所有注释一律中文，使用文档注释（`/** */` / `//`），与现有 `useCatBrain.ts`、`frames.ts` 风格一致。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/actions/segments.ts` | 段区间常量、`SegmentRange`/`TwitchDef`/`SegmentedActionDef` 类型、`SLEEP_SEGMENTED`/`IDLE_SEGMENTED` 配置、`SEGMENTED_ACTIONS` 注册表 | 新增 |
| `src/composables/useSegmentedAction.ts` | 分段动作运行器（阶段状态机 + yoyo/切片/倒序辅助），对外 `currentSrc` / `start` / `requestExit` / `stop` | 新增 |
| `src/composables/useCatBrain.ts` | idle 与 sleep 改走运行器；wake 走 `requestExit`（起身）；wink 保持原 `anim` 路径；用 `activePlayer` 选择当前帧来源 | 修改 |
| `src/actions/index.ts` | `ACTIONS.sleep` 去掉已被运行器接管的 `loop`/`loopFrom`/`autoWakeMs`，仅保留 `label`/`fps`/`interruptible`/`idle` 元数据 | 修改 |
| `src/composables/useSpriteAnimation.ts` | 通用逐帧播放器 | **不改** |

---

## Task 1: 段配置与类型 `src/actions/segments.ts`

**Files:**
- Create: `src/actions/segments.ts`

- [ ] **Step 1: 创建 `src/actions/segments.ts`，写入类型与配置**

```ts
/**
 * 分段动作配置 —— sleep 与 idle 共用的声明式描述。
 *
 * 一个「分段动作」由可选的开场（intro）、循环基底（base）、随机插播的小动作
 * （twitches）和可选的退场（outro）组成。运行器（见 `useSegmentedAction`）读取
 * 本配置来编排播放：intro 正放一次 → base 循环 → 每隔随机间隔插播一个 twitch →
 * 收到退出请求时放 outro 一次。
 *
 * 区间端点约定：左闭右开（`start` 含、`end` 不含），与 `Array.prototype.slice`
 * 一致，运行器内统一用 `frames.slice(start, end)`。
 */
import { FRAMES, IDLE_FRAMES } from "./frames";

/** 一段帧区间（左闭右开）。 */
export interface SegmentRange {
  /** 起始帧索引（含）。 */
  start: number;
  /** 结束帧索引（不含）。 */
  end: number;
}

/** 一个随机插播的小动作。 */
export interface TwitchDef {
  /** 调试用标签，如 "ear" / "tail"。 */
  name: string;
  /** 该小动作的帧区间。 */
  range: SegmentRange;
  /** 随机权重，默认 1。 */
  weight?: number;
  /** 该段播放速度（fps），默认取动作级 fps。 */
  fps?: number;
  /**
   * yoyo 来回播放（正放 + 反放），默认 false。开启后该小动作会「出去再收回」，
   * 例如「摇尾巴」开启即等于连甩两下。
   */
  yoyo?: boolean;
}

/** 一个完整的分段动作配置。 */
export interface SegmentedActionDef {
  /** 源帧列表（sleep → cat-sleep；idle → cat-idla）。 */
  frames: string[];
  /** 进入时正放一次的开场段（可选）。 */
  intro?: SegmentRange;
  /** 循环基底段（默认 yoyo 来回，见 `baseYoyo`）。 */
  base: SegmentRange;
  /** 随机插播池（可为空数组＝纯基底循环）。 */
  twitches: TwitchDef[];
  /**
   * 退场段（可选）。传 `'introReversed'` 表示「把 intro 倒序播放」，
   * 用于睡觉起身＝趴下过程反放。
   */
  outro?: SegmentRange | "introReversed";
  /** 两次插播之间的随机间隔 [min, max]（毫秒）。 */
  twitchDelay: [number, number];
  /** 动作级默认播放速度（fps）。 */
  fps: number;
  /** intro / outro 单独的 fps（趴下/起身可调快），默认取 `fps`。 */
  introFps?: number;
  /** base 是否 yoyo 来回，默认 true。 */
  baseYoyo?: boolean;
  /** 自动结束的毫秒数（sleep 的 2 分钟自动醒）；不设＝不自动结束。 */
  autoEndMs?: number;
}

/**
 * 睡觉的分段配置。区间为「大概值」，端点按左闭右开换算（后续逐帧微调）：
 *   intro   0–189（趴下，倒放＝起身）
 *   base    180–195（安静呼吸）
 *   ear     195–214（动耳朵）
 *   tail    215–240（摇尾巴，yoyo＝连甩两下）
 */
export const SLEEP_SEGMENTED: SegmentedActionDef = {
  frames: FRAMES.sleep,
  intro: { start: 0, end: 190 },
  base: { start: 180, end: 196 },
  twitches: [
    { name: "ear", range: { start: 195, end: 215 } },
    { name: "tail", range: { start: 215, end: 241 }, yoyo: true },
  ],
  outro: "introReversed",
  twitchDelay: [3000, 7000],
  fps: 24,
  introFps: 36, // 趴下/起身稍快，避免 190 帧 @24fps ≈ 8s 过慢
  baseYoyo: true,
  autoEndMs: 120000,
};

/**
 * idle 的分段配置 —— 退化接入：整段 cat-idla 普通循环、无插播，行为与改动前一致。
 * 以后只需往 `twitches` 填区间、或设 `baseYoyo`/缩小 `base` 即可启用细分。
 */
export const IDLE_SEGMENTED: SegmentedActionDef = {
  frames: IDLE_FRAMES,
  base: { start: 0, end: IDLE_FRAMES.length },
  twitches: [],
  twitchDelay: [6000, 14000],
  fps: 24,
  baseYoyo: false,
};

/**
 * 可被 `trigger(name)` 触发、且由分段运行器播放的动作。
 * 不在此表中的动作（如 wink）走 `useCatBrain` 里原有的一次性播放路径。
 */
export const SEGMENTED_ACTIONS: Record<string, SegmentedActionDef> = {
  sleep: SLEEP_SEGMENTED,
};
```

- [ ] **Step 2: 类型检查**

Run: `pnpm build`
Expected: 通过（无类型错误）。若报 `FRAMES`/`IDLE_FRAMES` 导入问题，确认 `src/actions/frames.ts` 已导出二者（现状已导出）。

- [ ] **Step 3: 提交**

```bash
git add src/actions/segments.ts
git commit -m "feat: 新增分段动作配置与类型（sleep/idle）"
```

---

## Task 2: 分段运行器 `src/composables/useSegmentedAction.ts`

**Files:**
- Create: `src/composables/useSegmentedAction.ts`

- [ ] **Step 1: 创建运行器文件，写入完整实现**

```ts
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
    if (!cfg) return;
    player.play(baseFrames, { fps: cfg.fps, loop: true });
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
```

- [ ] **Step 2: 类型检查**

Run: `pnpm build`
Expected: 通过。常见问题：`SegmentRange`/`TwitchDef` 未从 `../actions/segments` 导出 —— 确认 Task 1 已 `export` 它们。

- [ ] **Step 3: 提交**

```bash
git add src/composables/useSegmentedAction.ts
git commit -m "feat: 新增分段动作运行器 useSegmentedAction"
```

---

## Task 3: `ACTIONS.sleep` 精简为元数据

**Files:**
- Modify: `src/actions/index.ts`（`ACTIONS.sleep` 条目）

- [ ] **Step 1: 改写 `ACTIONS.sleep`，去掉已被运行器接管的字段**

把 `src/actions/index.ts` 中的 `sleep` 条目（现含 `loop`/`loopFrom`/`autoWakeMs`）整体替换为：

```ts
  sleep: {
    label: "睡觉",
    // 播放（趴下/呼吸/插播/起身/自动醒）已由 SLEEP_SEGMENTED + useSegmentedAction 接管，
    // 这里仅保留状态机用到的元数据：interruptible（鼠标移动不唤醒）、idle（纳入空闲自动播放池）、
    // label/fps。fps 对分段播放无效，仅为满足 ActionDef 类型而保留。
    fps: 24,
    interruptible: false,
    idle: true,
  },
```

- [ ] **Step 2: 类型检查**

Run: `pnpm build`
Expected: 通过。`loopFrom`/`loop`/`autoWakeMs` 是 `ActionDef` 上的可选字段，删除不影响类型。

- [ ] **Step 3: 提交**

```bash
git add src/actions/index.ts
git commit -m "refactor: ACTIONS.sleep 精简为元数据（播放交给分段运行器）"
```

---

## Task 4: `useCatBrain` 接入分段运行器

**Files:**
- Modify: `src/composables/useCatBrain.ts`（整文件按下方替换关键部分）

本任务把 idle 与 sleep 改走 `useSegmentedAction`，wake 走起身 outro，wink 等一次性动作保持原 `anim` 路径，并用 `activePlayer` 选择当前帧来源。删除已被运行器接管的 `actionWakeTimer` 及其清理函数。

- [ ] **Step 1: 调整 import 与实例化**

在文件顶部 import 区，把对 segments 的依赖加上：

```ts
import { ACTIONS, IDLE_POOL } from "../actions";
import { FRAMES, IDLE_FRAMES } from "../actions/frames";
import { SEGMENTED_ACTIONS, IDLE_SEGMENTED } from "../actions/segments";
import { useGaze } from "./useGaze";
import { useSpriteAnimation } from "./useSpriteAnimation";
import { useSegmentedAction } from "./useSegmentedAction";
```

在 `useCatBrain` 函数体内，`const anim = useSpriteAnimation();` 之后新增运行器实例，并新增 `activePlayer`：

```ts
  const gaze = useGaze();
  const anim = useSpriteAnimation();      // 仅供 wink 等一次性动作使用
  const seg = useSegmentedAction();       // idle 与 sleep 的分段播放

  const state = ref<CatState>({ kind: "idle" });
  const cursorOverCat = ref(false);

  /** 当前帧来源选择子：gaze（注视）/ seg（分段：idle、sleep）/ anim（一次性动作）。 */
  const activePlayer = ref<"gaze" | "seg" | "anim">("seg");
```

- [ ] **Step 2: 改写 `currentSrc` 计算属性**

把原来的 `currentSrc`（在 follow 与 anim 之间二选一）替换为按 `activePlayer` 三选一：

```ts
  // 帧来源由 activePlayer 决定：follow 走注视；idle/sleep 走分段运行器；wink 走一次性播放器。
  const currentSrc = computed(() => {
    switch (activePlayer.value) {
      case "gaze":
        return gaze.currentSrc.value;
      case "anim":
        return anim.currentSrc.value;
      case "seg":
      default:
        return seg.currentSrc.value;
    }
  });
```

- [ ] **Step 3: 删除 `actionWakeTimer` 相关代码**

删除以下三处（自动结束已移入运行器）：
1. 变量声明 `let actionWakeTimer: number | undefined;`
2. 整个 `clearActionWakeTimer()` 函数定义
3. 所有对 `clearActionWakeTimer()` 的调用

保留 `actionResume`（仍用于决定醒来后回 follow 还是 idle）。

- [ ] **Step 4: 改写 `enterIdle` / `enterFollow`**

```ts
  function enterIdle() {
    clearIdleActionTimer();
    anim.stop();
    activePlayer.value = "seg";
    state.value = { kind: "idle" };
    // idle 走分段运行器的退化配置（整段循环、无插播）。
    seg.start(IDLE_SEGMENTED);
    scheduleIdleAction();
  }

  function enterFollow() {
    clearIdleActionTimer();
    // 跟随期间由注视驱动帧，停掉两个时序播放器。
    anim.stop();
    seg.stop();
    activePlayer.value = "gaze";
    state.value = { kind: "follow" };
  }
```

- [ ] **Step 5: 改写 `finishAction` / `wake`**

```ts
  /** 结束当前动作，回到恢复目标（follow / idle）。 */
  function finishAction() {
    if (actionResume === "follow" && opts.followEnabled()) enterFollow();
    else enterIdle();
  }

  /**
   * 立即把猫从当前动作中唤醒（例如 sleep 期间的一次点击）。
   * 分段动作（sleep）走 requestExit —— 先放起身 outro 再 finishAction；
   * 一次性动作直接停后结束。若当前不在 action 中则为空操作。
   */
  function wake() {
    if (state.value.kind !== "action") return;
    if (activePlayer.value === "seg") {
      seg.requestExit(finishAction); // 起身（倒放趴下）后回到 follow/idle
    } else {
      anim.stop();
      finishAction();
    }
  }
```

- [ ] **Step 6: 改写 `trigger`**

```ts
  function trigger(name: string, resume: "follow" | "idle" = "follow") {
    // 分段动作（sleep）：交给运行器，autoEndMs 到点用 finishAction 自动起身。
    const segCfg = SEGMENTED_ACTIONS[name];
    if (segCfg) {
      clearIdleActionTimer();
      actionResume = resume;
      activePlayer.value = "seg";
      state.value = { kind: "action", action: name };
      anim.stop();
      seg.start(segCfg, finishAction);
      return;
    }

    // 一次性动作（wink 等）：走通用播放器，结束时 finishAction。
    const def = ACTIONS[name];
    const frames = FRAMES[name];
    if (!def || !frames || frames.length === 0) return;
    clearIdleActionTimer();
    actionResume = resume;
    activePlayer.value = "anim";
    seg.stop();
    state.value = { kind: "action", action: name };
    const loop = def.loop ?? false;
    anim.play(
      frames,
      { fps: def.fps, loop, loopFrom: def.loopFrom },
      finishAction,
    );
  }
```

- [ ] **Step 7: 改写 tick 中 `action` 分支的中断逻辑**

把 `action` case 里原本 `anim.stop(); enterFollow();` 改为只调 `enterFollow()`（它已会停掉两个播放器）：

```ts
      case "action": {
        // 可打断的动作在鼠标移动时切换到 follow（sleep 不可打断，此处不会触发）。
        const def = ACTIONS[state.value.action ?? ""];
        if (def?.interruptible !== false && moved && following) {
          enterFollow();
        }
        return;
      }
```

- [ ] **Step 8: 更新 `onUnmounted` 清理**

确保卸载时停掉运行器（移除对 `clearActionWakeTimer` 的调用）：

```ts
  onUnmounted(() => {
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    clearIdleActionTimer();
    anim.stop();
    seg.stop();
    unlisten?.();
  });
```

- [ ] **Step 9: 类型检查**

Run: `pnpm build`
Expected: 通过。若报「`clearActionWakeTimer` 未定义」说明 Step 3 有遗漏调用未删除；若报 `IDLE_FRAMES` 未使用，确认是否还有其它引用（`enterIdle` 已不再直接用它，可一并从 import 移除 `IDLE_FRAMES`，仅保留 `FRAMES`）。

- [ ] **Step 10: 提交**

```bash
git add src/composables/useCatBrain.ts
git commit -m "feat: useCatBrain 让 idle/sleep 走分段运行器，起床倒放起身"
```

---

## Task 5: 手动验证与微调

**Files:**
- 视观察结果可能微调：`src/actions/segments.ts`（段端点 / fps / 间隔）

- [ ] **Step 1: 启动应用**

Run: `pnpm app:dev`
Expected: 窗口出现，猫正常显示、能跟随光标。

- [ ] **Step 2: 逐项观察（对照预期）**

1. 触发睡觉（右键菜单「睡觉」/ 或静置等 idle 自动选中 sleep）→ 猫**趴下**（intro 正放一次，约 5–6s @36fps）。
2. 熟睡期间大部分时间是**安静呼吸**（180–195 yoyo 来回），每隔 3–7s **随机**动一次耳朵或摇一次尾巴（尾巴 yoyo＝甩两下），动完归于平静。
3. **点击猫** → 猫**起身**（intro 倒放）后恢复跟随 / idle。
4. 睡觉时**移动鼠标不应唤醒**（interruptible:false）。
5. 静置 **2 分钟** → 自动起身（autoEndMs）。
6. 普通 **idle**（未睡觉的休息）行为与改动前一致（cat-idla 整段循环）。
7. **wink** 动作（若被 idle 自动选中）仍正常播放并结束。

- [ ] **Step 3: 按需微调（可选）**

若某段不自然（端点跳帧、太快/太慢、插播太频繁），仅调 `src/actions/segments.ts` 里的 `SLEEP_SEGMENTED` 常量（区间 / `fps` / `introFps` / `twitchDelay` / `yoyo`）。改完重跑 `pnpm app:dev` 观察。

- [ ] **Step 4: 提交微调（若有）**

```bash
git add src/actions/segments.ts
git commit -m "tune: 调整睡觉分段区间/速度/间隔"
```

---

## Self-Review

**1. 规格覆盖**
- 通用分段机制（配置 + 运行器）→ Task 1、2 ✅
- 趴下（intro 正放）/ 呼吸基底（base yoyo）/ 随机插播（twitches）/ 起身（outro=introReversed）/ 自动醒（autoEndMs）→ Task 2 运行器 + Task 1 sleep 配置 ✅
- twitch 支持 yoyo（摇尾巴连甩两下）→ Task 1 `tail.yoyo:true` + Task 2 `buildSegment` ✅
- idle 退化接入、行为不变、留好插播位 → Task 1 `IDLE_SEGMENTED` + Task 4 `enterIdle` ✅
- 与 useCatBrain 整合（idle/sleep/wake/autoEnd/currentSrc/interruptible/卸载）→ Task 4 ✅
- 不改 `useSpriteAnimation` → 全程未触碰 ✅
- 边界竞态：退出时中断插播（requestExit 清 twitchTimer）、autoEnd 与点击幂等（`exiting` 守卫）、差一错误（统一 slice 左闭右开）→ Task 2 ✅

**2. 占位符扫描**：无 TBD/TODO；所有步骤含完整代码与确切命令。区间「大概值」是用户明确要求、且有 Task 5 微调兜底，非占位符。

**3. 类型一致性**：`SegmentedActionDef`/`TwitchDef`/`SegmentRange`（Task 1 定义）→ Task 2 `import type` 一致；运行器对外 `start(cfg, onAutoEnd?)` / `requestExit(onDone)` / `stop()` / `currentSrc` 与 Task 4 调用点一致；`activePlayer` 三态 `'gaze'|'seg'|'anim'` 在 currentSrc 与各状态切换处一致；`SEGMENTED_ACTIONS`/`IDLE_SEGMENTED` 命名 Task 1 导出与 Task 4 import 一致。
</content>
