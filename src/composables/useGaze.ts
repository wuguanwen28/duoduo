/**
 * useGaze — maps a cursor angle to the matching gaze frame.
 *
 * This is the cursor-following behaviour, extracted from the old inline logic
 * in Pet.vue. Unlike timed actions, it is angle-driven: the backend reports
 * the clockwise screen angle from the cat's head to the cursor, and this
 * composable converts it to the internal clock convention and looks up the
 * frame. It is intentionally pure/stateless apart from the resolved `src`.
 *
 * Gaze map (clock angle → frame index): clock is measured with 0° = looking
 * UP, increasing CLOCKWISE (90° = right, 180° = down, 270° = left). These
 * anchors were read off the actual sprites; the gaze makes exactly one
 * clockwise loop across the 169-frame sequence.
 */
import { computed, ref, type Ref } from "vue";
import { FOLLOW_FRAMES } from "../actions/frames";

const ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 15], // up
  [45, 45], // up-right
  [90, 63], // right
  [135, 81], // down-right
  [180, 93], // down
  [225, 108], // down-left
  [270, 120], // left
  [315, 135], // up-left
  [360, 168], // up (loop close)
];

/** Piecewise-linear lookup: clock angle (0..360) → frame index. */
export function angleToFrame(clock: number): number {
  const a = ((clock % 360) + 360) % 360;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a0, f0] = ANCHORS[i];
    const [a1, f1] = ANCHORS[i + 1];
    if (a >= a0 && a <= a1) {
      const t = (a - a0) / (a1 - a0);
      return Math.round(f0 + t * (f1 - f0));
    }
  }
  return 0;
}

export interface GazeController {
  /** Reactive URL of the gaze frame to show right now. */
  currentSrc: Ref<string>;
  /** Current resolved frame index (for debugging). */
  frameIndex: Ref<number>;
  /**
   * Feed a new gaze sample. `screenAngle` is the backend's clockwise screen
   * angle (0 = right, 90 = down), or `null` when the cursor is in the head
   * dead zone — in which case the cat faces forward (frame 0).
   */
  update: (screenAngle: number | null) => void;
}

export function useGaze(): GazeController {
  const frameIndex = ref(0);
  const frames = FOLLOW_FRAMES;

  const currentSrc = computed(
    () => frames[Math.min(frameIndex.value, frames.length - 1)] ?? frames[0] ?? "",
  );

  function update(screenAngle: number | null) {
    if (screenAngle === null) {
      frameIndex.value = 0;
      return;
    }
    // Convert screen convention (0 = right) to clock convention (0 = up).
    const clock = (screenAngle + 90) % 360;
    frameIndex.value = angleToFrame(clock);
  }

  return { currentSrc, frameIndex, update };
}
