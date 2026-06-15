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
  /** 点击互动：idle/follow 状态下随机播放一个空闲小动作。 */
  poke: () => void;
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

  /** 从 idle 的随机插播池里按权重挑一个动作。 */
  function pickIdleTwitch() {
    const items = BEHAVIORS.idle.loop.random;
    if (items.length === 0) return null;
    const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
    if (total <= 0) return items[Math.floor(Math.random() * items.length)];
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.weight ?? 1;
      if (r < 0) return item;
    }
    return items[items.length - 1];
  }

  function poke() {
    const pick = pickIdleTwitch();
    if (!pick) return;
    if (state.value.kind === "behavior" && currentBehavior === "idle" && beh.canWake()) {
      beh.playOneShot(pick.clip);
      return;
    }
    if (state.value.kind === "follow") {
      goToBehavior("idle", pick.clip);
    }
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

  return { state, currentSrc, cursorOverCat, config, trigger, wake, poke, canWake };
}
