<template>
  <div class="dial">
    <!-- 锚点尺寸固定为收起态：圆盘绝对定位浮在它上面，展开时不挤动旁边的输入框。
         前提：所在容器 overflow 可见。弹窗已改用 grid 列表（无表格裁切），故溢出能正常显示。 -->
    <div class="dial__anchor">
      <div
        ref="padRef"
        class="dial__pad"
        :class="{
          'dial__pad--expanded': expanded,
          'dial__pad--active': dragging,
        }"
        @pointerenter="hovering = true"
        @pointerleave="hovering = false"
        @pointerdown="onDown"
      >
        <span
          v-for="t in TICKS"
          :key="t"
          class="dial__tick"
          :style="tickStyle(t)"
        ></span>
        <span
          class="dial__needle"
          :style="{ transform: `rotate(${modelValue}deg)` }"
        ></span>
        <span class="dial__hub"></span>
      </div>
    </div>
    <el-input-number
      class="dial__num"
      :model-value="modelValue"
      :min="0"
      :max="359"
      :step="15"
      size="small"
      controls-position="right"
      @update:model-value="onNum"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * DirectionDial —— 圆盘方向选择器。
 *
 * 角度约定与后端一致：0° = 正右，顺时针为正，90° = 正下。屏幕 y 轴向下，
 * 所以 `Math.atan2(dy, dx)` 天然就是这套约定，不需要额外换算。
 *
 * 拖动指针即改方向，默认吸附到 15° 整数倍；按住 Alt 拖动可自由微调。
 * 旁边的数字框做精确输入。
 *
 * 尺寸两态：平时收起成小圆点（只露指针，够看清朝向即可），鼠标移上去或
 * 正在拖动时才展开成大盘（露出 8 向刻度，好瞄准）。展开靠绝对定位浮在固定
 * 尺寸的锚点上，所以周围布局不会被推挤——这一点对每行一个圆盘尤其重要。
 * 注意：展开会向四周溢出，宿主容器必须 overflow 可见，否则圆盘会被截断。
 */
import { computed, onUnmounted, ref } from 'vue'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

/** 8 向刻度角度（度）。 */
const TICKS = [0, 45, 90, 135, 180, 225, 270, 315]

/** 拖动时的吸附步长（度）；按住 Alt 时不吸附。 */
const SNAP_DEG = 15

const padRef = ref<HTMLElement>()
const dragging = ref(false)
const hovering = ref(false)

/** 展开态：悬停或拖动中。拖动时即便指针移出圆盘也保持展开，否则会中途缩回。 */
const expanded = computed(() => hovering.value || dragging.value)

/** 把刻度点摆到圆周上：先转到该角度，再沿半径推出去。 */
function tickStyle(deg: number) {
  return { transform: `rotate(${deg}deg) translateX(var(--dial-r))` }
}

/** 归一化到 [0,360) 的整数角度。 */
function norm(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360
}

/** 由指针位置换算角度。 */
function angleFrom(e: PointerEvent): number {
  const el = padRef.value
  if (!el) return props.modelValue
  const r = el.getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (!e.altKey) deg = Math.round(deg / SNAP_DEG) * SNAP_DEG
  return norm(deg)
}

function onMove(e: PointerEvent) {
  emit('update:modelValue', angleFrom(e))
}

function onUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
}

function onDown(e: PointerEvent) {
  dragging.value = true
  emit('update:modelValue', angleFrom(e))
  // 绑到 window 而非圆盘：指针拖出圆盘外仍然跟手。
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onNum(v: number | undefined) {
  emit('update:modelValue', norm(v ?? 0))
}

onUnmounted(onUp)
</script>

<style scoped>
.dial {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* 布局只按收起态算尺寸；圆盘绝对定位居中其上，展开时向四周溢出而不推挤兄弟节点。 */
.dial__anchor {
  position: relative;
  width: 28px;
  height: 28px;
  flex: none;
}

/* --dial-r 是圆盘半径：刻度点与指针都沿这个距离摆到圆周上，随展开态一起变。 */
.dial__pad {
  --dial-r: 11px;
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border-radius: 50%;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  cursor: grab;
  touch-action: none;
  transition:
    width 0.15s ease,
    height 0.15s ease,
    margin 0.15s ease;
}

/* 展开态：抬到上层并加投影，避免在列表里被相邻元素压住看不清。 */
.dial__pad--expanded {
  --dial-r: 26px;
  width: 64px;
  height: 64px;
  margin: -32px 0 0 -32px;
  z-index: 10;
  box-shadow: var(--el-box-shadow-light);
}

.dial__pad--active {
  cursor: grabbing;
  border-color: var(--el-color-primary);
}

/* 刻度点、指针、轴心都以圆心为变换原点，靠 rotate + translateX 摆位。 */
.dial__tick,
.dial__needle,
.dial__hub {
  position: absolute;
  left: 50%;
  top: 50%;
  pointer-events: none;
}

/* 刻度只在展开态露出：收起态太小，八个点挤在一起反而糊成一圈。 */
.dial__tick {
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: var(--el-border-color-darker);
  opacity: 0;
  /* 刻度盒被 margin 双向居中，盒中心即圆心，旋转原点取 50% 50%。 */
  transform-origin: 50% 50%;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.dial__pad--expanded .dial__tick {
  opacity: 1;
}

/* 指针：从圆心向右伸出一条，rotate 到目标角度。
   只过渡长度不过渡 rotate——拖动时角度必须立刻跟手，加动画会显得黏。 */
.dial__needle {
  width: var(--dial-r);
  height: 2px;
  margin-top: -1px;
  border-radius: 1px;
  background: var(--el-color-primary);
  transition: width 0.15s ease;
  /* 指针 left:50% 且无水平 margin，盒左缘中点即圆心，旋转原点取 0 50%。
     若误用 0 0 会让原点偏上 1px，指针根部脱离轴心、转动时画弧偏心。 */
  transform-origin: 0 50%;
}

.dial__hub {
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: var(--el-color-primary);
}

.dial__num {
  width: 110px;
}
</style>
