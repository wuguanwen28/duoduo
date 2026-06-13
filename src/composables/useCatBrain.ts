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
    // 动作未到「可唤醒点」时忽略点击：一次性动作要完整播完；有 loop 的要先到达
    // 熟睡(base)才允许唤醒。趴下中、起身中点击均无效，避免「没躺下就被叫起来」。
    if (!beh.canWake()) return;
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
        // 仅当鼠标移动且光标在头部死区之外(angle 非 null)时才进入 follow；
        // 死区内不跟随，避免在死区里晃鼠标导致 idle/follow 每帧来回跳。
        if (moved && following && sample.angle !== null) enterFollow();
        return;
      }
      case "follow": {
        if (!following || Date.now() - lastMoveAt > config.idleTimeoutMs) {
          enterIdle();
          return;
        }
        // 光标进入头部死区(angle 为 null)：直接转入 idle，而不是朝前发呆。
        if (sample.angle === null) {
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
