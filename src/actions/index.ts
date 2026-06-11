/**
 * Action registry — maps action names to their configuration.
 *
 * To add a new action:
 * 1. Drop frames under `src/assets/<dir>/` as zero-padded `frame_XXXXXX.webp`.
 * 2. Add a glob entry in `./frames.ts`.
 * 3. Add an entry here with the matching `dir`.
 */

export interface ActionDef {
  /** Human-readable label for debugging / toasts. */
  label: string
  /** Asset subdirectory name under `src/assets/`. Must match a key in `frames.ts`. */
  dir: string
  /** Playback speed in frames per second. */
  fps: number
  /** Whether to loop (defaults to false = one-shot). */
  loop?: boolean
}

export const ACTIONS: Record<string, ActionDef> = {
  wiki: {
    label: 'wiki',
    dir: 'cat-webp-wiki',
    fps: 24,
  },
} as const

export type ActionName = keyof typeof ACTIONS

/** Look up an action definition (with narrowing). */
export function getAction(name: string): ActionDef | undefined {
  return ACTIONS[name]
}
