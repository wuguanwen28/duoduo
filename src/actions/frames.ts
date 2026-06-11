/**
 * Frame loader — eagerly imports sprite frames for each sprite set.
 *
 * Vite requires `import.meta.glob` patterns to be static string literals, so
 * each directory gets its own explicit glob. Frames are zero-padded 6-digit
 * (`frame_000000.webp` …), and lexical sort happens to equal numeric order,
 * so `Object.keys(...).sort()` yields frames in playback order — the array
 * index equals the frame number.
 *
 * To add a new action:
 * 1. Drop frames under `src/assets/<new-dir>/` as `frame_XXXXXX.webp`.
 * 2. Copy a glob block below, replacing the directory name.
 * 3. Add the key to the `FRAMES` record, then register it in `./index.ts`.
 */

/** Helper: turn a glob result map into a frame-ordered URL array. */
function toFrameList(map: Record<string, string>): string[] {
  return Object.keys(map)
    .sort()
    .map((k) => map[k]);
}

/** Follow/gaze frames — the cursor-tracking sprite loop (169 frames). */
const followFrames = import.meta.glob<string>("../assets/cat-webp/*.webp", {
  eager: true,
  import: "default",
});

/** Idle frames — the resting loop shown when the cat has nothing to do. */
const idleFrames = import.meta.glob<string>("../assets/cat-idla/*.webp", {
  eager: true,
  import: "default",
});

/** Action frame sets (one directory per action). */
const wikiFrames = import.meta.glob<string>("../assets/cat-wiki/*.webp", {
  eager: true,
  import: "default",
});

const sleepFrames = import.meta.glob<string>("../assets/cat-sleep/*.webp", {
  eager: true,
  import: "default",
});

/**
 * Frames for the gaze/follow behaviour. Kept separate from action FRAMES
 * because it is driven by cursor angle (see `useGaze`), not a fps timer.
 */
export const FOLLOW_FRAMES: string[] = toFrameList(followFrames);

/**
 * Frames for the idle resting loop. Driven by an fps timer (see `useCatBrain`'s
 * idle state), looped forever until the cat wakes to follow or plays an action.
 */
export const IDLE_FRAMES: string[] = toFrameList(idleFrames);

/** Action name → ordered frame URLs. Keys MUST match `ACTIONS` in `./index.ts`. */
export const FRAMES: Record<string, string[]> = {
  wiki: toFrameList(wikiFrames),
  sleep: toFrameList(sleepFrames),
};
