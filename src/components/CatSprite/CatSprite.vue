<template>
  <img class="cat-sprite" :src="src" alt="cat" draggable="false" />
</template>

<script lang="ts" setup>
/**
 * CatSprite — pure presentation. Renders whatever frame URL it is handed.
 * All "which frame" logic lives in useCatBrain; this component just paints.
 * Sizing is handled by the parent's wrapper (so the el-popover reference and
 * drag handlers stay on a single sized element in Pet.vue).
 */
defineProps<{ src: string }>();
</script>

<style scoped>
.cat-sprite {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
</style>
