/**
 * useCatBrain — the cat's behaviour state machine.
 *
 * This is the single source of truth for "what frame should the cat show right
 * now". It owns an explicit state machine and a ~20fps tick loop, and composes
 * two lower-level behaviours:
 *   - useGaze            (cursor-following, angle-driven)
 *   - useSpriteAnimation (timed action playback)
 *
 * States
 *   idle    : resting. After a random delay it auto-plays one of IDLE_POOL.
 *   follow  : tracking the cursor (gaze).
 *   action  : playing a one-shot / looping action (wiki, sleep, …).
 *
 * Transitions (the whole policy lives in `config`, so a future orchestration
 * layer can swap it wholesale):
 *   any non-action + mouse moves        → follow
 *   follow + mouse still > idleTimeoutMs → idle
 *   idle  + random timer fires           → action (from IDLE_POOL) → idle
 *   trigger(name)                        → action → follow|idle on done
 *   action(interruptible) + mouse moves  → follow
 *
 * Reserved orchestration interface
 *   - `trigger(name, resume?)` — imperatively play an action.
 *   - the backend `pet-play-action` event is forwarded to `trigger`.
 *   - `config` is mutable, so timeouts / idle pool can be retuned live.
 * A future "编排器" can drive the cat purely through `trigger` + `config`
 * without touching this file.
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ACTIONS, IDLE_POOL } from "../actions";
import { FRAMES, IDLE_FRAMES } from "../actions/frames";
import { useGaze } from "./useGaze";
import { useSpriteAnimation } from "./useSpriteAnimation";

/** Gaze sample returned by the Rust `pet_cursor_angle` command. */
interface GazeSample {
  angle: number | null;
  cursor_x: number;
  cursor_y: number;
}

export type CatStateKind = "idle" | "follow" | "action";

export interface CatState {
  kind: CatStateKind;
  /** Present only when kind === "action". */
  action?: string;
}

export interface BrainConfig {
  /** Tick interval in ms (gaze sampling rate). */
  tickMs: number;
  /** Cursor displacement (physical px) above which we count the mouse "moved". */
  moveThreshold: number;
  /** While following, drop to idle after the cursor is still this long (ms). */
  idleTimeoutMs: number;
  /** Playback speed (fps) of the looping idle resting animation. */
  idleFps: number;
  /** Random delay window [min, max] (ms) before idle auto-plays an action. */
  idleActionDelay: [number, number];
  /** Action names eligible for idle auto-play. Empty = just loop idle. */
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
  /** Getter for whether cursor-following is enabled (the "别偷看" toggle). */
  followEnabled: () => boolean;
  /** Partial overrides merged onto DEFAULT_CONFIG. */
  config?: Partial<BrainConfig>;
}

export interface CatBrain {
  /** Current machine state (read-only view). */
  state: Ref<CatState>;
  /** The frame URL to display right now. Bind this to <CatSprite :src>. */
  currentSrc: Ref<string>;
  /** Live, mutable behaviour config (retune timeouts / idle pool at runtime). */
  config: BrainConfig;
  /**
   * Play an action, overriding any current behaviour. When it finishes the cat
   * returns to `resume` ("follow" if following is on, else "idle"). No-op if
   * the action is unknown or has no frames.
   */
  trigger: (name: string, resume?: "follow" | "idle") => void;
}

export function useCatBrain(opts: BrainOptions): CatBrain {
  const config: BrainConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const gaze = useGaze();
  const anim = useSpriteAnimation();

  const state = ref<CatState>({ kind: "idle" });

  // Only `follow` is angle-driven (gaze). `idle` and `action` are both timed
  // animations, so they read from the shared sprite player.
  const currentSrc = computed(() =>
    state.value.kind === "follow" ? gaze.currentSrc.value : anim.currentSrc.value,
  );

  let lastPos: { x: number; y: number } | null = null;
  let lastMoveAt = 0;
  let tickTimer: number | undefined;
  let idleActionTimer: number | undefined;
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
      const pool = config.idlePool;
      const name = pool[Math.floor(Math.random() * pool.length)];
      trigger(name, "idle");
    }, delay);
  }

  function enterIdle() {
    clearIdleActionTimer();
    state.value = { kind: "idle" };
    // Idle is its own looping resting animation.
    anim.play(IDLE_FRAMES, { fps: config.idleFps, loop: true });
    scheduleIdleAction();
  }

  function enterFollow() {
    clearIdleActionTimer();
    anim.stop(); // gaze drives the frame while following
    state.value = { kind: "follow" };
  }

  function trigger(name: string, resume: "follow" | "idle" = "follow") {
    const def = ACTIONS[name];
    const frames = FRAMES[name];
    if (!def || !frames || frames.length === 0) return;
    clearIdleActionTimer();
    state.value = { kind: "action", action: name };
    anim.play(
      frames,
      { fps: def.fps, loop: def.loop ?? false },
      () => {
        // Resume target is re-evaluated at finish time.
        if (resume === "follow" && opts.followEnabled()) enterFollow();
        else enterIdle();
      },
    );
  }

  async function tick() {
    let sample: GazeSample;
    try {
      sample = await invoke<GazeSample>("pet_cursor_angle");
    } catch {
      return; // transient IPC error during teardown
    }

    // Movement detection from raw global cursor position.
    let moved = false;
    const pos = { x: sample.cursor_x, y: sample.cursor_y };
    if (lastPos) {
      moved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > config.moveThreshold;
    }
    lastPos = pos;
    if (moved) lastMoveAt = Date.now();

    const following = opts.followEnabled();

    switch (state.value.kind) {
      case "action": {
        // Interruptible actions wake to follow when the mouse moves.
        const def = ACTIONS[state.value.action ?? ""];
        if (def?.interruptible !== false && moved && following) {
          anim.stop();
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
      // Event wiring unavailable (e.g. during teardown) — ignore.
    }
  });

  onUnmounted(() => {
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    clearIdleActionTimer();
    anim.stop();
    unlisten?.();
  });

  return { state, currentSrc, config, trigger };
}
