<template>
  <div v-if="active" class="sprite-anim" :style="containerStyle">
    <img class="sprite-anim__img" :src="currentFrame" alt="" draggable="false" />
  </div>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from "vue";
import { ACTIONS, type ActionName } from "../../actions";
import { FRAMES } from "../../actions/frames";

const props = withDefaults(
  defineProps<{
    /** Action to play. Set to null to stop. */
    action: ActionName | null;
    /** Sprite scale factor (mirrors Pet's size slider). */
    size?: number;
    /** Override the action's default loop setting. */
    loop?: boolean;
  }>(),
  { size: 1.0, loop: undefined },
);

const emit = defineEmits<{
  (e: "start", action: ActionName): void;
  (e: "done", action: ActionName): void;
}>();

const active = ref(false);
const frameIdx = ref(0);
let timer: number | undefined;

/** Frame URLs for the currently selected action. */
const frameList = computed(() => {
  if (!props.action) return [] as string[];
  return FRAMES[props.action] ?? ([] as string[]);
});

const currentFrame = computed(() => {
  const f = frameList.value;
  if (f.length === 0) return "";
  return f[Math.min(frameIdx.value, f.length - 1)] ?? f[0];
});

const containerStyle = computed(() => {
  const px = Math.round(200 * (props.size ?? 1.0));
  return { width: `${px}px`, height: `${px}px` };
});

function stop() {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
  active.value = false;
}

function play(name?: ActionName) {
  const actionName = name ?? props.action;
  if (!actionName) return;

  const def = ACTIONS[actionName];
  if (!def) return;

  const frames = FRAMES[actionName];
  if (!frames || frames.length === 0) return;

  stop();

  frameIdx.value = 0;
  active.value = true;
  emit("start", actionName);

  const fps = def.fps;
  const interval = Math.round(1000 / fps);
  const total = frames.length;
  const shouldLoop = props.loop ?? def.loop ?? false;

  timer = window.setInterval(() => {
    frameIdx.value++;
    if (frameIdx.value >= total) {
      if (shouldLoop) {
        frameIdx.value = 0;
      } else {
        stop();
        emit("done", actionName);
      }
    }
  }, interval);
}

/** Play on mount (when v-if creates the component with action already set)
 *  and restart whenever the action prop changes. */
watch(
  () => props.action,
  (newAction) => {
    if (newAction) {
      play(newAction);
    } else {
      stop();
    }
  },
  { immediate: true },
);

onUnmounted(() => stop());

defineExpose({ play, stop });
</script>

<style scoped>
.sprite-anim {
  display: flex;
  align-items: center;
  justify-content: center;
}

.sprite-anim__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
</style>
