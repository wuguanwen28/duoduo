<template>
  <img class="cat-sprite" :src="src" alt="cat" draggable="false" />
</template>

<script lang="ts" setup>
/**
 * CatSprite —— 纯展示组件。传入哪个帧的 URL 就渲染哪个帧。
 * 所有“显示哪一帧”的逻辑都位于 useCatBrain 中，本组件只负责绘制。
 * 尺寸由父级的包裹元素处理（这样 el-popover 的 reference 和
 * 拖拽处理器就能集中在 Pet.vue 中同一个有尺寸的元素上）。
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
