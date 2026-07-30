<template>
  <el-dialog
    v-model="visible"
    title="视觉对齐 · 可视化设置"
    width="600px"
    append-to-body
    align-center
  >
    <div class="tf__bar">
      <span class="tf__label">对比底图</span>
      <el-select
        v-model="baseKey"
        clearable
        placeholder="不显示"
        class="tf__sel"
      >
        <el-option
          v-for="o in baseOptions"
          :key="o.key"
          :label="o.label"
          :value="o.key"
        />
      </el-select>
      <!-- 逃生口：选动作办不到时（设计稿、标了中线的标尺图、还没建成动作的散图）
           直接挑一张图当参考。图标按钮而非与下拉平级，视觉上明确选动作是主路径。 -->
      <el-tooltip content="选一张图片当参考（按原图显示，不套用偏移缩放）">
        <el-button
          :icon="Picture"
          :type="customPath ? 'primary' : undefined"
          :plain="!!customPath"
          @click="pickCustom"
        />
      </el-tooltip>
      <span class="tf__label">底图透明度</span>
      <el-slider
        v-model="baseOpacity"
        :min="0.1"
        :max="1"
        :step="0.05"
        :show-tooltip="false"
        :disabled="!baseUrl || compareMode !== 'overlay'"
        class="tf__slider"
      />
    </div>

    <!-- 对比方式：仅有底图时出现。差值/双色是「像素级对齐」的两把尺子，
         叠加则保留原始观感（透明度滑杆只在叠加模式下有意义）。 -->
    <div v-if="baseUrl" class="tf__bar">
      <span class="tf__label">对比方式</span>
      <el-radio-group v-model="compareMode">
        <el-tooltip content="半透明叠加，可调底图透明度">
          <el-radio-button value="overlay">叠加</el-radio-button>
        </el-tooltip>
        <el-tooltip
          content="像素相减：完全重合处变黑，错位边缘发亮——越黑越对齐"
        >
          <el-radio-button value="difference">差值</el-radio-button>
        </el-tooltip>
        <el-tooltip
          content="底图染红、当前动作染青，重合处变暗——露红边或青边即错位"
        >
          <el-radio-button value="tint">双色</el-radio-button>
        </el-tooltip>
      </el-radio-group>
    </div>

    <!-- 舞台：外层 viewport 留出余量，让拖出方框的部分仍可见；
         内层 200×200 方框 = 猫在窗口里的实际占位（对应 Pet.vue 的 200*size 精灵盒）。 -->
    <div
      class="tf__viewport"
      @wheel.prevent="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div class="tf__stage">
        <img
          v-if="baseUrl"
          class="tf__img"
          :src="baseUrl"
          :style="baseStyle"
          draggable="false"
          alt="底图"
        />
        <img
          v-if="url"
          class="tf__img"
          :src="url"
          :style="draftStyle"
          draggable="false"
          alt="当前动作"
        />
      </div>
      <p v-if="!url" class="tf__empty">该动作的图片目录里没有可预览的帧</p>
    </div>
    <p class="tf__hint">
      拖动改位置，滚轮改缩放；虚线框 =
      猫的实际占位，缩放以底边中点为锚（猫脚不动）。
      <template v-if="customPath">
        <br />
        参考图：{{ customName }}（按原图显示，不套用偏移缩放）
        <el-button link type="primary" size="small" @click="clearCustom">
          移除
        </el-button>
      </template>
    </p>

    <!-- 翻转开关先隐藏：默认不翻转（baseFlip=false），数据模型保留，日后需要再放开此 v-if。 -->
    <div v-if="false" class="tf__bar">
      <span class="tf__label">水平翻转</span>
      <el-switch v-model="draftFlip" />
      <span class="tf__sub"
        >素材第一步怎么放（与运动无关；移动方向不一致时在此之上再翻一次）</span
      >
    </div>
    <el-form label-width="72px" label-position="right" class="tf__form">
      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item label="X轴偏移">
            <el-input-number
              v-model="draftX"
              :step="0.001"
              :precision="3"
              :style="{ width: '100%' }"
              controls-position="right"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="Y轴偏移">
            <el-input-number
              v-model="draftY"
              :step="0.001"
              :precision="3"
              :style="{ width: '100%' }"
              controls-position="right"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="缩放">
            <el-input-number
              v-model="draftScale"
              :step="0.005"
              :precision="2"
              :min="0.1"
              :style="{ width: '100%' }"
              controls-position="right"
            />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <template #footer>
      <el-button @click="resetDraft">重置</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * TransformDialog —— 视觉对齐（偏移 / 缩放）的可视化编辑弹窗。
 *
 * 不同文件夹的素材里猫的位置与大小不一致，靠盲填小数很难对齐。这里把首帧渲染
 * 在一个 200×200 的方框里直接拖，并可叠一张底图做对比。
 *
 * 底图有两种，互斥（同时叠三张看不清谁是谁）：
 * - **其他动作的首帧**（主路径）：套用该动作自己的偏移/缩放，故对比出来的是
 *   两个动作在猫窗里的**真实相对关系**，这正是配对齐时要看的东西。
 * - **用户自选图片**（逃生口）：设计稿、标了中线的标尺图、还没建成动作的散图。
 *   没有 transform 可循，按原图铺满显示。
 *
 * 与 `MoveSegmentsDialog` 同样编辑**草稿副本**、点「确定」才写回 ActionRow：
 * 资源设置页对 actions 开了 deep watch 自动保存，直接改原对象会让拖动过程中
 * 每一帧都写一次 manifest 并触发猫窗热重载。
 *
 * 预览的换算必须与 `Pet.vue` 的 `spriteTransform` 一致：偏移以精灵直径为基准
 * （`translate(直径 * offset)`），缩放锚点为 `bottom center`，且 translate 写在
 * scale 左侧——故拖动位移不受当前缩放影响，1px 就是 1px。
 */
import { computed, ref, watch } from 'vue'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Picture } from '@element-plus/icons-vue'
import { currentCatId } from '../../pet-core/catContext'
import type { ActionRow } from './manifestTypes'

/**
 * 舞台边长（像素），同时是偏移量的换算基准：
 * 与 Pet.vue 里 `base = 200 * size` 的 200 对应（预览按 size=1 呈现），
 * 因此拖动 1px = 偏移 1/200，所见即所得。
 */
const STAGE = 200

/** 滚轮缩放的上下限；下限与输入框的 `:min` 一致，上限仅约束滚轮不失控。 */
const SCALE_MIN = 0.1
const SCALE_MAX = 5

const props = defineProps<{
  /** 弹窗显隐。 */
  modelValue: boolean
  /** 被编辑的动作行（点「确定」时才写回）。 */
  action: ActionRow
  /** 全部动作，用于挑选对比底图。 */
  actions: ActionRow[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const draftX = ref(0)
const draftY = ref(0)
const draftScale = ref(1)
const draftFlip = ref(false)

/** 当前动作首帧的 asset URL；空串 = 没有可预览的帧。 */
const url = ref('')
/** 对比底图（另一个动作的首帧）的 asset URL。 */
const baseUrl = ref('')
/** 选中的底图动作 key；空 = 不显示底图。 */
const baseKey = ref('')
const baseOpacity = ref(0.5)
/**
 * 用户自选参考图的绝对路径；非空时**优先于**选中的动作底图。
 * 二者互斥：同时叠三张图看不清谁是谁，故选其一即清掉另一个。
 */
const customPath = ref('')

/**
 * 对比方式（有底图时生效）：
 * - overlay：半透明叠加（原始观感，透明度可调）；
 * - difference：像素差值，完全重合处为纯黑，错位边缘发亮——「越黑越对齐」，
 *   人眼判断黑不黑远比判断两张半透明图糊在一起容易；
 * - tint：底图染红、当前动作染青（onion-skin 双色），重合处混成暗色，
 *   哪边露出红/青边就说明往哪边错了位——适合两张图内容本就不同的场景。
 */
type CompareMode = 'overlay' | 'difference' | 'tint'
const compareMode = ref<CompareMode>('overlay')

/**
 * 双色模式的染色滤镜：grayscale+sepia 先把图压成单色调，再用 hue-rotate 转到
 * 目标色相（sepia 本身偏黄 ~40°，红减 ~50°、青加 ~130°）。
 */
const TINT_RED = 'grayscale(1) sepia(1) saturate(3) hue-rotate(-50deg)'
const TINT_CYAN = 'grayscale(1) sepia(1) saturate(3) hue-rotate(130deg)'

/** 参考图文件名（提示里只展示文件名，全路径太长挤爆一行）。 */
const customName = computed(
  () => customPath.value.split(/[\\/]/).pop() ?? customPath.value,
)

/** 非有限数一律按 0 处理——manifest 手写出错时不至于把预览整成 NaN。 */
function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** 偏移保留 3 位、缩放保留 2 位：与下方输入框的 precision 对齐，避免长尾小数。 */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 按 Pet.vue 的同一套换算生成预览样式。 */
function styleOf(
  ox: number,
  oy: number,
  sc: number,
  opacity: number,
  flip = false,
) {
  return {
    transform: `translate(${Math.round(STAGE * num(ox))}px, ${Math.round(
      STAGE * num(oy),
    )}px) scale(${num(sc, 1)})${flip ? ' scaleX(-1)' : ''}`,
    transformOrigin: 'bottom center',
    opacity: `${opacity}`,
  }
}

const draftStyle = computed(() => {
  const s = styleOf(
    draftX.value,
    draftY.value,
    draftScale.value,
    1,
    draftFlip.value,
  )
  // 无底图时对比模式无意义，按普通叠加渲染。
  if (!baseUrl.value) return s
  if (compareMode.value === 'difference') {
    // 差值：与底图逐像素相减，重合处归零变黑。
    return { ...s, mixBlendMode: 'difference' as const }
  }
  if (compareMode.value === 'tint') {
    // 双色：当前动作染青，multiply 让红青重合处混成暗色。
    return { ...s, filter: TINT_CYAN, mixBlendMode: 'multiply' as const }
  }
  return s
})

/** 底图按它自己配置的偏移/缩放渲染——这样对比的才是两者在窗口里的真实相对关系。 */
const baseAction = computed(() =>
  props.actions.find((a) => a.key === baseKey.value),
)

/**
 * 底图实际透明度：差值/双色都要求两图不透明才数学成立
 * （半透明会让差值黑不下去、双色混不出暗色），仅叠加模式用用户设的透明度。
 */
const effectiveBaseOpacity = computed(() =>
  compareMode.value === 'overlay' ? baseOpacity.value : 1,
)

/**
 * 底图样式。动作底图套用它自己的 transform；自选参考图**不套用**——它没有
 * transform 可循（不是本应用的动作），原样铺满方框当标尺看即可。
 */
const baseStyle = computed(() => {
  const base = customPath.value
    ? styleOf(0, 0, 1, effectiveBaseOpacity.value)
    : baseAction.value
      ? styleOf(
          baseAction.value.offsetX,
          baseAction.value.offsetY,
          baseAction.value.scale,
          effectiveBaseOpacity.value,
        )
      : null
  if (!base) return {}
  // 双色模式底图染红；差值模式底图不加滤镜（相减在上层图完成）。
  if (compareMode.value === 'tint') return { ...base, filter: TINT_RED }
  return base
})

/** 可选底图：排除自己与没配图片目录的动作。 */
const baseOptions = computed(() =>
  props.actions
    .filter((a) => a.key !== props.action.key && a.dir.trim() !== '')
    .map((a, i) => ({ key: a.key, label: a.name || `动作${i + 1}` })),
)

/** 取某目录的首帧并转成 asset URL；取不到时返回空串（显示占位，不报错）。 */
async function loadFrame(dir: string): Promise<string> {
  if (!dir.trim()) return ''
  try {
    const p = await invoke<string | null>('pet_first_frame', {
      catId: currentCatId.value,
      dir,
    })
    return p ? convertFileSrc(p) : ''
  } catch {
    return ''
  }
}

/** 把草稿还原为打开弹窗时的动作配置（不是清零——「重置」指撤销本次改动）。 */
function resetDraft() {
  draftX.value = num(props.action.offsetX)
  draftY.value = num(props.action.offsetY)
  draftScale.value = num(props.action.scale, 1)
  draftFlip.value = !!props.action.flip
}

// 每次打开都重新取草稿与首帧；底图选择不跨次保留，避免切到别的动作时残留。
watch(
  visible,
  async (open) => {
    if (!open) return
    resetDraft()
    baseKey.value = ''
    customPath.value = ''
    baseUrl.value = ''
    compareMode.value = 'overlay'
    url.value = await loadFrame(props.action.dir)
  },
  { immediate: true },
)

watch(baseKey, async (k) => {
  if (!k) {
    // 清空下拉时若还挂着参考图，保留参考图；否则收掉底图。
    if (!customPath.value) baseUrl.value = ''
    return
  }
  // 选了动作底图 → 让位：清掉参考图，避免叠三张图看不清。
  customPath.value = ''
  const a = props.actions.find((x) => x.key === k)
  baseUrl.value = a ? await loadFrame(a.dir) : ''
})

/** 挑一张任意图片当参考图；需显式授 asset 白名单（可能在资源根之外）。 */
async function pickCustom() {
  let picked: string | null = null
  try {
    const p = await open({
      multiple: false,
      filters: [
        {
          name: '图片',
          extensions: ['webp', 'png', 'jpg', 'jpeg', 'gif', 'bmp'],
        },
      ],
    })
    if (typeof p === 'string') picked = p
  } catch (e) {
    ElMessage.error(`选择图片失败：${e}`)
    return
  }
  if (!picked) return
  if (!(await invoke<boolean>('pet_allow_asset', { path: picked }))) {
    ElMessage.error('这张图片读不到，换一张试试')
    return
  }
  // 参考图与动作底图互斥：挑了图就清掉下拉选择。
  baseKey.value = ''
  customPath.value = picked
  baseUrl.value = convertFileSrc(picked)
}

function clearCustom() {
  customPath.value = ''
  baseUrl.value = ''
}

// ── 拖动与滚轮 ────────────────────────────────────────
let dragging = false
let startX = 0
let startY = 0
let startOX = 0
let startOY = 0

function onDown(e: PointerEvent) {
  if (!url.value) return
  dragging = true
  startX = e.clientX
  startY = e.clientY
  startOX = draftX.value
  startOY = draftY.value
  // 指针捕获：拖出舞台范围也不断线，松手前一直跟手。
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!dragging) return
  draftX.value = round3(startOX + (e.clientX - startX) / STAGE)
  draftY.value = round3(startOY + (e.clientY - startY) / STAGE)
}

function onUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // 指针已释放（如 pointercancel）——忽略。
  }
}

function onWheel(e: WheelEvent) {
  if (!url.value) return
  const next = num(draftScale.value, 1) + (e.deltaY < 0 ? 0.05 : -0.05)
  draftScale.value = clamp(round2(next), SCALE_MIN, SCALE_MAX)
}

function confirm() {
  props.action.offsetX = num(draftX.value)
  props.action.offsetY = num(draftY.value)
  props.action.scale = num(draftScale.value, 1)
  props.action.flip = draftFlip.value
  visible.value = false
}
</script>

<style scoped>
.tf__bar {
  user-select: none;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.tf__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.tf__sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
.tf__sel {
  width: 160px;
}
.tf__slider {
  flex: 1;
  min-width: 80px;
}

/* 舞台外框：给方框四周留余量，拖出去的部分仍看得见；棋盘格衬透明像素。 */
.tf__viewport {
  position: relative;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  border-radius: 6px;
  background-color: var(--el-fill-color-lighter);
  background-image:
    linear-gradient(45deg, var(--el-fill-color) 25%, transparent 25%),
    linear-gradient(-45deg, var(--el-fill-color) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--el-fill-color) 75%),
    linear-gradient(-45deg, transparent 75%, var(--el-fill-color) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}
.tf__viewport:active {
  cursor: grabbing;
}

/* 200×200 = 猫在窗口里的实际占位，与 Pet.vue 的精灵盒一一对应。
   isolation 把差值/正片叠底的混合圈在两张图之间，不与棋盘格背景混合。 */
.tf__stage {
  position: relative;
  width: 200px;
  height: 200px;
  border: 1px dashed var(--el-color-primary);
  border-radius: 2px;
  isolation: isolate;
}
.tf__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.tf__empty {
  position: absolute;
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.tf__hint {
  margin: 8px 0 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.tf__form {
  margin-top: 4px;
}
</style>
