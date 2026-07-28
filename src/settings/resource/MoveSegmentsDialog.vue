<template>
  <el-dialog
    v-model="visible"
    title="窗口移动 · 高级配置"
    width="620px"
    append-to-body
  >
    <div class="seg__opts">
      <span class="seg__opt">
        <span class="seg__label">循环</span>
        <el-switch v-model="draftLoop" />
      </span>
      <span class="seg__opt">
        <span class="seg__label">撞边转身</span>
        <el-switch v-model="draftBounce" />
      </span>
    </div>

    <!-- 用 grid 列表代替 el-table：表格包裹层会裁剪方向圆盘的展开溢出，
         而普通 grid 单元格默认 overflow 可见，圆盘能正常浮出，无需任何 hack。 -->
    <div class="seg__head">
      <span class="seg__c seg__c--idx">#</span>
      <span class="seg__c">方向</span>
      <span class="seg__c">速度 px/秒</span>
      <span class="seg__c">时长 毫秒</span>
      <span class="seg__c seg__c--ops">操作</span>
    </div>
    <div v-for="(row, i) in draftSegments" :key="i" class="seg__row">
      <span class="seg__c seg__c--idx">{{ i + 1 }}</span>
      <span class="seg__c seg__c--dir">
        <DirectionDial v-model="row.dir" />
      </span>
      <span class="seg__c">
        <el-input-number
          v-model="row.speed"
          :min="0"
          :max="2000"
          :step="10"
          size="small"
          :style="{ width: '100%' }"
          controls-position="right"
        />
      </span>
      <span class="seg__c">
        <el-input-number
          v-model="row.ms"
          :min="0"
          :step="500"
          size="small"
          :style="{ width: '100%' }"
          controls-position="right"
        />
      </span>
      <span class="seg__c seg__c--ops">
        <el-button
          link
          :icon="Top"
          :disabled="i === 0"
          @click="moveSeg(i, -1)"
        />
        <el-button
          link
          :icon="Bottom"
          :disabled="i === draftSegments.length - 1"
          @click="moveSeg(i, 1)"
        />
        <el-button link type="danger" :icon="Delete" @click="removeSeg(i)" />
      </span>
    </div>
    <p v-if="draftSegments.length === 0" class="seg__empty">
      暂无位移段 —— 该动作不会移动窗口，需要时点下方「添加一段」。
    </p>

    <el-button class="seg__add" :icon="Plus" size="small" @click="addSeg">
      添加一段
    </el-button>
    <p class="seg__hint">
      没有任何段 = 该动作不移动；速度填 0 = 原地停顿；时长填 0 =
      这一段一直走下去（其后的段不会执行）。
    </p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * MoveSegmentsDialog —— 多段位移编辑弹窗。
 *
 * 编辑的是一份**草稿副本**，点「确定」才写回 ActionRow。原因：资源设置页对
 * actions 开了 deep watch 自动保存，直接改原对象会让弹窗里每敲一个键就写一次
 * manifest 并触发猫窗热重载，编辑体验会被打断。
 */
import { computed, ref, watch } from 'vue'
import { Plus, Delete, Top, Bottom } from '@element-plus/icons-vue'
import DirectionDial from './DirectionDial.vue'
import type { ActionRow, MoveSegmentRow } from './manifestTypes'

const props = defineProps<{
  /** 弹窗显隐。 */
  modelValue: boolean
  /** 被编辑的动作行（点「确定」时才写回）。 */
  action: ActionRow
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const draftLoop = ref(true)
const draftBounce = ref(true)
const draftSegments = ref<MoveSegmentRow[]>([])

// 每次打开都从当前动作行重新取一份深拷贝草稿。
watch(
  visible,
  (open) => {
    if (!open) return
    draftLoop.value = props.action.moveLoop
    draftBounce.value = props.action.moveBounce
    // 0 段 = 无位移，保持空表（不再补占位段）；用户可点「添加一段」开始配置。
    draftSegments.value = props.action.moveSegments.map((s) => ({ ...s }))
  },
  { immediate: true },
)

function addSeg() {
  // 新段沿用上一段的方向与速度，改时长即可——比每次从 0 开始顺手。
  const last = draftSegments.value[draftSegments.value.length - 1]
  draftSegments.value.push({
    dir: last?.dir ?? 0,
    speed: last?.speed ?? 0,
    ms: last?.ms || 2000,
  })
}

function removeSeg(i: number) {
  draftSegments.value.splice(i, 1)
}

/** 上移(-1) / 下移(1) 第 i 段。 */
function moveSeg(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= draftSegments.value.length) return
  const arr = draftSegments.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function confirm() {
  props.action.moveLoop = draftLoop.value
  props.action.moveBounce = draftBounce.value
  props.action.moveSegments = draftSegments.value.map((s) => ({ ...s }))
  visible.value = false
}
</script>

<style scoped>
.seg__opts {
  user-select: none;
  display: flex;
  gap: 24px;
  margin-bottom: 10px;
}
.seg__opt {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.seg__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

/* 表头与每行共用同一套列宽，保证纵向对齐。 */
.seg__head,
.seg__row {
  user-select: none;
  display: grid;
  grid-template-columns: 32px 150px 1fr 1fr 120px;
  align-items: center;
  column-gap: 8px;
}
.seg__head {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.seg__row {
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.seg__row:last-child {
  border-bottom: none;
}
.seg__c--idx {
  text-align: center;
  color: var(--el-text-color-secondary);
}
/* 方向列：圆盘展开会溢出本格，显式保证可见（grid 项默认即可，写明意图）。 */
.seg__c--dir {
  overflow: visible;
}
.seg__c--ops {
  display: flex;
  gap: 2px;
}

.seg__empty {
  margin: 0;
  padding: 16px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.seg__add {
  margin-top: 10px;
}
.seg__hint {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}
</style>
