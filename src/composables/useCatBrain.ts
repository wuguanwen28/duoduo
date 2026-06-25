/**
 * useCatBrain —— 猫的行为状态机。
 *
 * 组合 useGaze（光标跟随）与 useBehavior（动作 + 行为播放）。
 *
 * 状态：
 *   behavior : 正在运行某个自治行为（idle/sleep…），currentBehavior 记录是哪个。
 *   follow   : 跟随光标。
 *
 * 加权轮换：每个行为有 weight + duration；进入某行为后按其 duration 排定时器，到点按
 * weight 加权随机挑下一个行为，跨行为切换播离开者 exit→进入者 enter。idle 权重高、sleep 低，
 * 所以大部分时间待机、偶尔睡。follow 是抢占层（看 interruptible），期间暂停轮换。
 *
 * 触发：trigger(name) 先查行为（切过去待着）、再查动作（切到 idle 把该动作播一次）。
 *
 * 行为/动作数据来自外置资源（`getBehaviors`/`getClip`），故 useCatBrain 必须在
 * 资源加载成功后才被实例化（由 App.vue 保证：就绪才挂载 <Pet>）。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getBehaviors, getDefaultBehavior } from "../actions/behaviors";
import { getClip } from "../actions/clips";
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
  /** 高频采样间隔(毫秒)：跟随光标 / 可抢占的 idle 且光标在动时使用。 */
  tickMs: number;
  /** 低频采样间隔(毫秒)：sleep / 校准中 / 关闭跟随 / idle 久未动时使用，仅维持穿透判定与移动探测。 */
  idleTickMs: number;
  /** 光标静止超过该时长(毫秒)后，idle/follow 降为低频采样。 */
  stillnessMs: number;
  /** 光标位移(物理像素)超过该阈值时，才判定鼠标"移动了"。 */
  moveThreshold: number;
  /** 跟随状态下，光标静止超过这段时间(毫秒)后切回 idle。 */
  idleTimeoutMs: number;
}

export const DEFAULT_CONFIG: BrainConfig = {
  tickMs: 50,
  idleTickMs: 200,
  stillnessMs: 1000,
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
  // 行为库一次性读取（资源加载后不变）。
  const behaviors = getBehaviors();
  // 默认/兜底行为名（启动、follow 回落、触发动作的归属都用它）。
  const defaultBehavior = getDefaultBehavior();
  // 纯跟随模式：没有任何有效行为（但有 follow 素材，否则不会走到这里）。
  // 此时状态机不轮换行为，常驻 follow，由 gaze 出帧（死区锁正视帧）。
  const followOnly = Object.keys(behaviors).length === 0;
  const gaze = useGaze();
  const beh = useBehavior();

  const state = ref<CatState>(
    followOnly ? { kind: "follow" } : { kind: "behavior", behavior: defaultBehavior },
  );
  const cursorOverCat = ref(false);
  let currentBehavior = defaultBehavior;

  /** 当前帧来源：gaze(注视) / beh(行为播放器)。 */
  const activePlayer = ref<"gaze" | "beh">(followOnly ? "gaze" : "beh");
  const currentSrc = computed(() =>
    activePlayer.value === "gaze" ? gaze.currentSrc.value : beh.currentSrc.value,
  );

  let lastPos: { x: number; y: number } | null = null;
  let lastMoveAt = 0;
  let tickTimer: number | undefined;
  let disposed = false;
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
    const b = behaviors[currentBehavior];
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
    const names = Object.keys(behaviors);
    const weights = names.map((n) => behaviors[n].weight);
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
    const b = behaviors[name];
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
    goToBehavior(defaultBehavior);
  }

  /** 无默认行为（纯跟随）时，脱离行为把某动作播一次，播完回到跟随。 */
  function playStandaloneOnce(name: string) {
    clearRotationTimer();
    activePlayer.value = "beh";
    beh.playClipOnce(name, () => {
      // 播完回到跟随：切回 gaze 出帧并锁正视帧。
      activePlayer.value = "gaze";
      state.value = { kind: "follow" };
      gaze.update(null);
    });
  }

  function trigger(name: string) {
    if (behaviors[name]) {
      goToBehavior(name); // 行为：切过去待着
      return;
    }
    // 动作名：有默认行为则切过去并把该动作当 lead 播一次（feed/wink 等）；
    // 无默认行为（纯跟随）则脱离行为独立播一次，否则会无任何效果。
    if (getClip(name)) {
      if (behaviors[defaultBehavior]) goToBehavior(defaultBehavior, name);
      else playStandaloneOnce(name);
      return;
    }
    // 未知名：空操作
  }

  /** 点击是否会唤醒：当前行为有 exit 且已进 loop。 */
  function canWake() {
    if (state.value.kind !== "behavior") return false;
    return !!behaviors[currentBehavior]?.exit && beh.canWake();
  }

  function wake() {
    if (!canWake()) return;
    goToBehavior(defaultBehavior); // 播当前 exit（如 wakeUp 起身）→ 默认行为
  }

  /** 从 idle 的随机插播池里按权重挑一个动作。 */
  function pickIdleTwitch() {
    const items = behaviors[defaultBehavior]?.loop.random ?? [];
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
    if (state.value.kind === "behavior" && currentBehavior === defaultBehavior && beh.canWake()) {
      beh.playOneShot(pick.clip);
      return;
    }
    if (state.value.kind === "follow") {
      goToBehavior(defaultBehavior, pick.clip);
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

    // 纯跟随模式：常驻 follow，直接把角度喂给 gaze；不跟随/校准/死区 → 喂 null（正视）。
    if (followOnly) {
      const followingNow = !opts.paused?.() && opts.followEnabled();
      gaze.update(followingNow && sample.angle !== null ? sample.angle : null);
      return;
    }

    let moved = false;
    const pos = { x: sample.cursor_x, y: sample.cursor_y };
    if (lastPos) {
      moved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > config.moveThreshold;
    }
    lastPos = pos;
    if (moved) lastMoveAt = Date.now();

    // 校准期间：保持默认行为、暂停轮换、忽略光标。
    if (opts.paused?.()) {
      if (state.value.kind !== "behavior" || currentBehavior !== defaultBehavior) enterIdle();
      return;
    }

    const following = opts.followEnabled();

    switch (state.value.kind) {
      case "behavior": {
        const b = behaviors[currentBehavior];
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

  /**
   * 根据当前状态决定下一次注视采样的间隔（自适应降频）。
   *
   * 高频(`tickMs`)：正在跟随、或可抢占的 idle 且光标近期在动——需要流畅注视 / 灵敏抢占。
   * 低频(`idleTickMs`)：sleep 等不可中断行为 / 校准中 / 关闭跟随 / idle 久未动——
   *   这些情况不需要注视角度，仅维持 `over_cat`（点击穿透判定）与移动探测。
   */
  function nextDelay(): number {
    // 校准中：无需角度，低频维持穿透判定。
    if (opts.paused?.()) return config.idleTickMs;

    const following = opts.followEnabled();

    // 纯跟随模式：开启跟随时常驻 follow，需高频出帧；关闭则低频。
    if (followOnly) return following ? config.tickMs : config.idleTickMs;

    // 关闭跟随：无抢占、无注视，低频仅维持 over_cat。
    if (!following) return config.idleTickMs;

    // 不可中断行为（sleep）：不会被跟随抢占，低频。
    if (state.value.kind === "behavior" && behaviors[currentBehavior]?.interruptible !== true) {
      return config.idleTickMs;
    }

    // follow 进行中 / 可抢占的 idle：光标近期在动 → 高频；久未动 → 低频探测。
    return Date.now() - lastMoveAt > config.stillnessMs ? config.idleTickMs : config.tickMs;
  }

  /** 自适应采样循环：跑一次 tick，再按当前状态重排下一次。 */
  async function loop() {
    await tick();
    if (disposed) return; // 组件已卸载，停止重排
    tickTimer = window.setTimeout(loop, nextDelay());
  }

  onMounted(async () => {
    lastMoveAt = Date.now();
    if (followOnly) {
      // 纯跟随模式：常驻 follow，由 gaze 出帧（初始锁正视帧）。
      activePlayer.value = "gaze";
      state.value = { kind: "follow" };
      gaze.update(null);
    } else {
      // 起步：直接进入默认行为（无需转场）。
      currentBehavior = defaultBehavior;
      activePlayer.value = "beh";
      state.value = { kind: "behavior", behavior: defaultBehavior };
      beh.start(behaviors[defaultBehavior]);
      scheduleRotation();
    }
    void loop(); // 立即取首帧，随后按状态自适应重排
    try {
      unlisten = await listen<string>("pet-play-action", (e) => {
        if (typeof e.payload === "string") trigger(e.payload);
      });
    } catch {
      // 事件绑定不可用(例如销毁期间)—— 忽略。
    }
  });

  onUnmounted(() => {
    disposed = true;
    if (tickTimer !== undefined) window.clearTimeout(tickTimer);
    clearRotationTimer();
    beh.stop();
    unlisten?.();
  });

  return { state, currentSrc, cursorOverCat, config, trigger, wake, poke, canWake };
}
