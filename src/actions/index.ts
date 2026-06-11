/**
 * Action registry — declarative config for every timed sprite animation.
 *
 * An "action" is any behaviour driven by a frame-per-second timer (as opposed
 * to the cursor-following gaze, which is angle-driven — see `useGaze`). Sleep,
 * wiki, feed, etc. are all actions. The state machine (`useCatBrain`) reads
 * this table to decide how to play and when an action may be interrupted.
 *
 * To add a new action:
 * 1. Drop frames under `src/assets/<dir>/` as zero-padded `frame_XXXXXX.webp`.
 * 2. Add a glob entry + key in `./frames.ts` (the key must match `dir`'s use here).
 * 3. Add an entry below keyed by the same name used in `FRAMES`.
 */

export interface ActionDef {
  /** Human-readable label for debugging / toasts. */
  label: string;
  /** Playback speed in frames per second. */
  fps: number;
  /** Loop forever (true) or play once and finish (false). Default: false. */
  loop?: boolean;
  /**
   * Whether mouse movement can interrupt this action and snap back to follow.
   * Looping ambient actions (sleep) are usually interruptible; deliberate
   * one-shots (feed) usually are not. Default: true.
   */
  interruptible?: boolean;
  /**
   * Eligible for the idle auto-play pool. When the cat has been idle for a
   * while, `useCatBrain` randomly picks one of these to play. Default: false.
   */
  idle?: boolean;
}

export const ACTIONS: Record<string, ActionDef> = {
  wiki: {
    label: "wiki",
    fps: 24,
    loop: false,
    interruptible: true,
    idle: true,
  },
  sleep: {
    label: "睡觉",
    fps: 12,
    loop: true,
    interruptible: true,
    idle: true,
  },
} as const;

export type ActionName = keyof typeof ACTIONS;

/** Look up an action definition. */
export function getAction(name: string): ActionDef | undefined {
  return ACTIONS[name];
}

/** Action names eligible for idle auto-play (the `idle: true` subset). */
export const IDLE_POOL: string[] = Object.entries(ACTIONS)
  .filter(([, def]) => def.idle)
  .map(([name]) => name);
