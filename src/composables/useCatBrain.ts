/**
 * useCatBrain —— 猫的行为状态机。
 *
 * 这里是"猫此刻应该显示哪一帧"的唯一权威来源。它持有一个显式的状态机和一个
 * 约 20fps 的 tick 循环,并组合了两个更底层的行为:
 *   - useGaze            (跟随光标,由角度驱动)
 *   - useSpriteAnimation (按时序播放动作)
 *
 * 状态
 *   idle    : 休息。经过一段随机延迟后,会自动播放 IDLE_POOL 中的某个动作。
 *   follow  : 跟踪光标(注视)。
 *   action  : 播放一次性 / 循环动作(wiki、sleep 等)。
 *
 * 状态转换(整套策略都放在 `config` 里,因此未来的编排层可以整体替换它):
 *   任意非 action 状态 + 鼠标移动        → follow
 *   follow + 鼠标静止超过 idleTimeoutMs   → idle
 *   idle  + 随机定时器触发                → action(取自 IDLE_POOL)→ idle
 *   trigger(name)                        → action,结束后 → follow 或 idle
 *   action(可打断) + 鼠标移动            → follow
 *
 * 预留的编排接口
 *   - `trigger(name, resume?)` —— 命令式地播放一个动作。
 *   - 后端的 `pet-play-action` 事件会被转发到 `trigger`。
 *   - `config` 是可变的,因此超时时间 / idle 动作池可以在运行时重新调整。
 * 未来的"编排器"可以仅通过 `trigger` + `config` 来驱动猫,而无需改动本文件。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ACTIONS, IDLE_POOL } from "../actions";
import { FRAMES } from "../actions/frames";
import { SEGMENTED_ACTIONS, IDLE_SEGMENTED } from "../actions/segments";
import { useGaze } from "./useGaze";
import { useSpriteAnimation } from "./useSpriteAnimation";
import { useSegmentedAction } from "./useSegmentedAction";

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
  /** tick 间隔(毫秒,即注视采样频率)。 */
  tickMs: number;
  /** 光标位移(物理像素)超过该阈值时,才判定鼠标"移动了"。 */
  moveThreshold: number;
  /** 跟随状态下,光标静止超过这段时间(毫秒)后切回 idle。 */
  idleTimeoutMs: number;
  /** 循环播放的 idle 休息动画的播放速度(fps)。 */
  idleFps: number;
  /** idle 自动播放动作前的随机延迟区间 [min, max](毫秒)。 */
  idleActionDelay: [number, number];
  /** 可用于 idle 自动播放的动作名列表。为空 = 仅循环 idle。 */
  idlePool: string[];
}

export const DEFAULT_CONFIG: BrainConfig = {
  tickMs: 50,
  moveThreshold: 2,
  idleTimeoutMs: 5000,
  idleFps: 24,
  idleActionDelay: [6000, 14000],
  idlePool: IDLE_POOL,
};

export interface BrainOptions {
  /** 获取是否启用光标跟随("别偷看"开关)。 */
  followEnabled: () => boolean;
  /**
   * 获取大脑是否被冻结。为 true 时猫被保持在 idle:它忽略光标(永不进入
   * follow),且 idle 自动播放被抑制,因此头部保持不动。用于头部校准期间。
   * 默认:始终为 false。
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
  /**
   * 全局光标当前是否悬停在猫的精灵图上。由注视轮询驱动(即使窗口忽略光标
   * 事件时也能工作),因此 Pet.vue 无需自带光标监听器即可切换窗口的点击穿透。
   */
  cursorOverCat: Ref<boolean>;
  /** 实时可变的行为配置(可在运行时重新调整超时时间 / idle 动作池)。 */
  config: BrainConfig;
  /**
   * 播放一个动作,覆盖当前的任何行为。结束后猫会回到 `resume` 指定的状态
   * (若跟随已开启则为 "follow",否则为 "idle")。当动作未知或没有帧时为空操作。
   */
  trigger: (name: string, resume?: "follow" | "idle") => void;
  /** 立即把猫从当前动作中唤醒。若当前不在 action 中则为空操作。 */
  wake: () => void;
}

export function useCatBrain(opts: BrainOptions): CatBrain {
  const config: BrainConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const gaze = useGaze();
  const anim = useSpriteAnimation();      // 仅供 wiki 等一次性动作使用
  const seg = useSegmentedAction();       // idle 与 sleep 的分段播放

  const state = ref<CatState>({ kind: "idle" });
  const cursorOverCat = ref(false);

  /** 当前帧来源选择子：gaze（注视）/ seg（分段：idle、sleep）/ anim（一次性动作）。 */
  const activePlayer = ref<"gaze" | "seg" | "anim">("seg");

  // 帧来源由 activePlayer 决定：follow 走注视；idle/sleep 走分段运行器；wiki 走一次性播放器。
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

  let lastPos: { x: number; y: number } | null = null;
  let lastMoveAt = 0;
  let tickTimer: number | undefined;
  let idleActionTimer: number | undefined;
  // 针对循环动作(sleep):唤醒时要返回到哪个状态。
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
      // 冻结期间被抑制 —— 重新排期,以便在校准结束后恢复。
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
    anim.stop();
    activePlayer.value = "seg";
    state.value = { kind: "idle" };
    // idle 走分段运行器的退化配置（整段循环、无插播）；fps 用 config.idleFps，
    // 保留「可在运行时调整 idle 速度」的能力（覆盖 IDLE_SEGMENTED 的默认 fps）。
    seg.start({ ...IDLE_SEGMENTED, fps: config.idleFps });
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
      // 一次性动作（anim 路径）被点醒：直接停后结束（当前 wiki 可被鼠标移动打断，
      // 此分支为将来「不可打断的一次性动作」预留）。
      anim.stop();
      finishAction();
    }
  }

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

    // 一次性动作（wiki 等）：走通用播放器，结束时 finishAction。
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

  async function tick() {
    let sample: GazeSample;
    try {
      sample = await invoke<GazeSample>("pet_cursor_angle");
    } catch {
      return; // 销毁期间的瞬时 IPC 错误
    }

    // 发布光标是否悬停在猫上(用于驱动点击穿透)。无条件设置 —— 即使在暂停期间
    // 也设置 —— 以保持该标志的实时性。
    cursorOverCat.value = sample.over_cat;

    // 根据原始的全局光标位置进行移动检测。
    let moved = false;
    const pos = { x: sample.cursor_x, y: sample.cursor_y };
    if (lastPos) {
      moved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > config.moveThreshold;
    }
    lastPos = pos;
    if (moved) lastMoveAt = Date.now();

    // 冻结状态(例如头部校准期间):保持 idle,忽略光标,这样当用户拖动校准
    // 圆圈时头部不会跟踪鼠标。
    if (opts.paused?.()) {
      if (state.value.kind !== "idle") enterIdle();
      return;
    }

    const following = opts.followEnabled();

    switch (state.value.kind) {
      case "action": {
        // 可打断的动作在鼠标移动时切换到 follow（sleep 不可打断，此处不会触发）。
        const def = ACTIONS[state.value.action ?? ""];
        if (def?.interruptible !== false && moved && following) {
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
    anim.stop();
    seg.stop();
    unlisten?.();
  });

  return { state, currentSrc, cursorOverCat, config, trigger, wake };
}
