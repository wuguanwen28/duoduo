<template>
  <el-tooltip
    content="主要用来挑 base 动作的帧：循环播放时首尾帧要尽量重叠，叠在一起看是否对齐"
  >
    <template #content>
      <div style="text-align: center">
        此工具主要是用来挑 base 循环动作的起止帧数<br />
        如走路的循环动作，首帧和尾帧要尽量重叠，不然会有跳帧现象。
      </div>
    </template>
    <el-button :icon="Picture" @click="visible = true">逐帧对比</el-button>
  </el-tooltip>
  <el-dialog
    v-model="visible"
    width="780px"
    append-to-body
    align-center
    :footer="false"
    title="帧重叠对比"
  >
    <!-- 顶栏：选文件夹 + 对比方式 -->
    <div class="fc__bar">
      <el-button :icon="FolderOpened" @click="pickFolder">
        {{ files.length ? '换文件夹' : '选图片文件夹' }}
      </el-button>
      <span v-if="files.length" class="fc__count"
        >共 {{ files.length }} 张</span
      >
      <span class="fc__spacer" />
      <span class="fc__label">对比方式</span>
      <el-radio-group v-model="mode" :disabled="!files.length">
        <el-tooltip content="半透明叠加，每层可调透明度">
          <el-radio-button value="overlay">叠加</el-radio-button>
        </el-tooltip>
        <el-tooltip
          content="每层染不同色相、正片叠底：重合处变暗，露色边即错位"
        >
          <el-radio-button value="tint">双色</el-radio-button>
        </el-tooltip>
      </el-radio-group>
    </div>

    <!-- 层列表：底图固定在最前，可增删对比层，最多 MAX 张 -->
    <div v-if="files.length" class="fc__layers">
      <div v-for="(layer, i) in layers" :key="i" class="fc__layer">
        <span class="fc__lname">{{ i === 0 ? '底图' : `对比${i}` }}</span>
        <el-slider
          v-model="layer.index"
          :min="0"
          :max="maxIdx"
          :step="1"
          :format-tooltip="(v: number) => `第 ${v + 1} 帧`"
          class="fc__frame"
        />
        <span class="fc__idx">{{ layer.index + 1 }}/{{ files.length }}</span>
        <template v-if="mode === 'overlay'">
          <span class="fc__olabel">透明度</span>
          <el-slider
            v-model="layer.opacity"
            :min="0"
            :max="1"
            :step="0.01"
            :show-tooltip="false"
            class="fc__opacity"
          />
          <span class="fc__oval">{{ Math.round(layer.opacity * 100) }}%</span>
        </template>
        <span v-else class="fc__swatch" :style="{ background: tintHsl(i) }" />
        <el-button
          class="fc__del"
          text
          size="small"
          :icon="Close"
          :disabled="i === 0"
          @click="removeLayer(i)"
        />
      </div>
      <el-button
        v-if="layers.length < MAX"
        :icon="Plus"
        size="small"
        class="fc__add"
        @click="addLayer"
      >
        添加对比帧
      </el-button>
    </div>

    <!-- 舞台：层叠所有图，棋盘格衬透明像素；isolation 把正片叠底圈在图与图之间 -->
    <div class="fc__stage">
      <img
        v-for="(layer, i) in layers"
        :key="i"
        class="fc__img"
        :src="files[layer.index]?.url"
        :style="layerStyle(i)"
        draggable="false"
        alt="帧"
      />
      <p v-if="!files.length" class="fc__empty">先选一个图片文件夹</p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * FrameCompareDialog -- 帧重叠对比弹窗（自带「帧对比」触发按钮）。
 *
 * 由 `test.html` 提取而来：选一个图片文件夹（通常是视频转帧的输出目录），
 * 把任意几帧叠在一起看，便于检查循环动画的首尾帧是否对齐。父级直接放置即可，
 * 按钮就地渲染、弹窗 `append-to-body` 浮到 body，故放在头部 actions 槽里也行。
 *
 * 与 `test.html` 的差异：
 * - 底图 + 对比帧改为可增删，默认 2 张、最多 4 张，每层一条帧滑块；
 * - 对比方式保留「叠加」「双色」，去掉「差值」；
 * - 双色模式按层数自动均分色相（2 张即红+青，与 TransformDialog 一致）。
 *
 * 渲染用 `<img>` + `convertFileSrc`，图片路径由后端 `pet_list_frames_dir`
 * 列出并授权 asset 白名单。棋盘格背景让透明 WebP 的透明像素可见。
 */
import { computed, ref } from 'vue'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpened, Plus, Close, Picture } from '@element-plus/icons-vue'

/** 最多层数（底图 + 3 对比）。 */
const MAX = 4

/** 一张可对比的帧：文件名（展示用）+ 可直接加载的 asset URL。 */
interface FrameFile {
  name: string
  url: string
}

/** 一层对比：选中的帧序号 + 叠加模式下的不透明度。 */
interface Layer {
  index: number
  opacity: number
}

/** 弹窗显隐。组件自包含：触发按钮在内部，状态由内部管理。 */
const visible = ref(false)

const files = ref<FrameFile[]>([])
/** 层列表；layers[0] 为底图（不可删），其余为对比层。 */
const layers = ref<Layer[]>([])
const mode = ref<'overlay' | 'tint'>('overlay')

const maxIdx = computed(() => Math.max(0, files.value.length - 1))

/**
 * 双色模式的染色滤镜：grayscale+sepia 先压成单色调，再 hue-rotate 转到目标色相。
 * 基准 -50deg 对应红色（与 TransformDialog 的红一致），按层数均分 360°。
 */
function tintFilter(i: number): string {
  const rot = -50 + (i * 360) / layers.value.length
  return `grayscale(1) sepia(1) saturate(3) hue-rotate(${rot}deg)`
}

/** 双色色块图例：直接用 HSL 取同色相纯色，直观显示该层染什么色。 */
function tintHsl(i: number): string {
  const h = (i * 360) / layers.value.length
  return `hsl(${h} 75% 50%)`
}

/** 选图片文件夹 -> 后端列帧 -> 数值排序 -> 重置层。 */
async function pickFolder() {
  let picked: string | null = null
  try {
    const p = await open({ directory: true, multiple: false })
    if (typeof p === 'string') picked = p
  } catch (e) {
    ElMessage.error(`选择文件夹失败：${e}`)
    return
  }
  if (!picked) return
  try {
    const paths = await invoke<string[]>('pet_list_frames_dir', { dir: picked })
    // 后端按字典序返回，这里再按数值排序兜底，保证 frame_2 排在 frame_10 之前。
    paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    files.value = paths.map((p) => {
      const name = p.split(/[\\/]/).pop() ?? p
      return { name, url: convertFileSrc(p) }
    })
    resetLayers()
  } catch (e) {
    ElMessage.error(`读取文件夹失败：${e}`)
  }
}

/** 按当前帧数重置层：≥2 张默认底图+对比1，1 张只有底图，0 张清空。 */
function resetLayers() {
  const n = files.value.length
  if (n === 0) {
    layers.value = []
    return
  }
  layers.value = n >= 2 ? [newLayer(0, 1), newLayer(1, 0.5)] : [newLayer(0, 1)]
}

/** 造一层。 */
function newLayer(index: number, opacity: number): Layer {
  return { index, opacity }
}

/** 新增对比层：序号往中后段铺开，避免都挤在第 0 帧。 */
function addLayer() {
  if (layers.value.length >= MAX) return
  const idx = Math.min(
    maxIdx.value,
    Math.round((maxIdx.value * layers.value.length) / MAX),
  )
  layers.value.push(newLayer(idx, 0.5))
}

/** 删除某对比层（底图不可删）。 */
function removeLayer(i: number) {
  if (i === 0) return
  layers.value.splice(i, 1)
}

/**
 * 第 i 层的样式：
 * - tint：染色滤镜；底图只染色不混合，对比层正片叠底到下方（所有层不透明）。
 * - overlay：用该层透明度。
 */
function layerStyle(i: number) {
  if (mode.value === 'tint') {
    const filter = tintFilter(i)
    return i === 0 ? { filter } : { filter, mixBlendMode: 'multiply' as const }
  }
  return { opacity: String(layers.value[i].opacity) }
}
</script>

<style scoped lang="scss">
.fc__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.fc__count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.fc__spacer {
  flex: 1;
}

.fc__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.fc__layers {
  margin-bottom: 12px;
}

.fc__layer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.fc__lname {
  width: 48px;
  flex: none;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.fc__frame {
  flex: 1;
  min-width: 120px;
}

.fc__idx {
  width: 64px;
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: right;
}

.fc__olabel {
  width: 48px;
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: right;
}

.fc__opacity {
  width: 90px;
  flex: none;
}

.fc__oval {
  width: 36px;
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.fc__swatch {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 3px;
  border: 1px solid var(--el-border-color);
}

.fc__del {
  flex: none;
  margin-left: 2px;
}

.fc__add {
  margin-top: 4px;
}

/* 舞台：棋盘格衬透明像素；isolation 把 multiply 圈在图与图之间，不混棋盘格。 */
.fc__stage {
  position: relative;
  height: min(40vh, 320px);
  border-radius: 6px;
  overflow: hidden;
  isolation: isolate;
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

.fc__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.fc__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* 标题 + 标题右侧小说明（沿用对话框默认标题字号，说明用次级色弱化）。 */
.fc__title {
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.fc__titledesc {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
