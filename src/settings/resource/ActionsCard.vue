<template>
  <!-- 动作库：每个动作 = 一个帧文件夹 + 播放参数。key 自动生成、用户只填名称。 -->
  <el-card shadow="never" class="block">
    <template #header>
      <div class="block__head">
        <span class="block__title">🎬 动作库</span>
        <el-button :icon="Plus" size="small" @click="addAction"
          >添加动作</el-button
        >
      </div>
    </template>
    <el-empty
      v-if="actions.length === 0"
      description="还没有动作"
      :image-size="64"
    />
    <el-collapse v-else v-model="openActions" accordion>
      <el-collapse-item v-for="(a, i) in actions" :key="i" :name="i">
        <template #title>
          <div class="item__title-row">
            <span class="item__name">{{ a.name || `动作${i + 1}` }}</span>
            <el-button
              class="item__btn"
              type="primary"
              size="small"
              plain
              @click.stop="testPlay(a.key, a.name || `动作${i + 1}`)"
            >
              <el-icon><VideoPlay /></el-icon>
              预览
            </el-button>
            <el-popconfirm
              title="确定删除该动作吗？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm="removeAction(i)"
            >
              <template #reference>
                <el-button
                  class="item__btn"
                  type="danger"
                  size="small"
                  plain
                  @click.stop
                >
                  <el-icon><Delete /></el-icon>
                  删除
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </template>
        <el-form label-width="92px" label-position="right">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="名称">
                <el-input
                  v-model="a.name"
                  placeholder="动作名称（如 眨眼、摇尾巴）"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="图片目录">
                <DirSelect
                  v-model="a.dir"
                  :tree="dirTree"
                  placeholder="相对资源根或绝对路径"
                  @refresh="emit('refresh-dirs')"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="帧率fps">
                <el-input-number
                  v-model="a.fps"
                  :min="1"
                  :max="120"
                  :style="{ width: '100%' }"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="来回播放">
                <template #label>
                  <span class="label-with-help">
                    <el-tooltip placement="top">
                      <template #content>
                        <div>
                          如果素材首尾不连续，开启后会正序播放一次再倒序播放<br />
                          这样就能回到第一帧再衔接其他动作，如"呼吸动作"
                        </div>
                      </template>
                      <el-icon class="label-help"><QuestionFilled /></el-icon>
                    </el-tooltip>
                    往返播放
                  </span>
                </template>
                <el-switch v-model="a.yoyo" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="倒序播放">
                <el-switch v-model="a.reverse" />
              </el-form-item>
            </el-col>
          </el-row>
          <!-- 视觉对齐入口：偏移/缩放靠盲填小数很难对齐，改为拖拽式可视化弹窗。 -->
          <el-row :gutter="16">
            <el-col :span="12">
              <!-- 位移配置入口：label 占位对齐上方字段，按钮打开多段编辑弹窗；0 段 = 无位移。 -->
              <el-form-item label="位移配置">
                <el-button plain @click="openMove(i)"> 点击设置 </el-button>
                <span v-if="a.moveSegments.length > 0" class="hint">
                  当前 {{ a.moveSegments.length }} 段
                </span>
              </el-form-item>
            </el-col>
            <el-col :span="12" v-if="showTransform">
              <el-form-item label="视觉对齐">
                <el-button plain @click="openTransform(i)">
                  点击设置
                </el-button>
                <span v-if="isAligned(a)" class="hint">
                  偏移 {{ a.offsetX }}, {{ a.offsetY }} · 缩放 {{ a.scale
                  }}<template v-if="a.flip"> · 翻转</template>
                </span>
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </el-collapse-item>
    </el-collapse>
    <MoveSegmentsDialog
      v-if="moveIndex >= 0"
      v-model="moveOpen"
      :action="actions[moveIndex]"
    />
    <TransformDialog
      v-if="tfIndex >= 0"
      v-model="tfOpen"
      :action="actions[tfIndex]"
      :actions="actions"
    />
  </el-card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { emit as emitEvent } from '@tauri-apps/api/event'
import {
  Plus,
  Delete,
  VideoPlay,
  QuestionFilled,
} from '@element-plus/icons-vue'
import DirSelect, { type DirNode } from './DirSelect.vue'
import MoveSegmentsDialog from './MoveSegmentsDialog.vue'
import TransformDialog from './TransformDialog.vue'
import type { ActionRow } from './manifestTypes'
// 「变换」高级参数是否显示：由远程应用配置控制（启动时 loadAppConfig 拉取）。
import { showTransform } from '../../pet-core/appConfig'

const props = defineProps<{
  /** 动作列表（就地增删改；父组件持有同一引用）。 */
  actions: ActionRow[]
  /** 资源根下的子目录树，供「图片目录」树形下拉用。 */
  dirTree: DirNode[]
}>()

const emit = defineEmits<{
  /** 子下拉展开时请求父组件刷新目录树。 */
  (e: 'refresh-dirs'): void
}>()

/** 展开的折叠项 */
const openActions = ref<number[]>([0])

/**
 * 生成一个不与现有动作冲突的唯一 key（用户不可见，仅供引用使用）。
 * 形如 action1、action2…，自增直到不重复。
 */
function genActionKey(): string {
  const used = new Set(props.actions.map((a) => a.key))
  let i = 1
  let k = `action${i}`
  while (used.has(k)) k = `action${++i}`
  return k
}

function addAction() {
  // 新动作插到第一位；已展开项下标整体后移，并默认展开新项。
  props.actions.unshift({
    key: genActionKey(),
    name: '',
    dir: '',
    fps: 24,
    yoyo: false,
    reverse: false,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    flip: false,
    moveLoop: true,
    moveBounce: true,
    moveFacing: 'right',
    moveSegments: [],
  })
  openActions.value = [0, ...openActions.value.map((i) => i + 1)]
}

function removeAction(i: number) {
  props.actions.splice(i, 1)
}

/** 位移配置弹窗的显隐与目标动作下标（-1 = 从未打开过）。 */
const moveOpen = ref(false)
const moveIndex = ref(-1)

function openMove(i: number) {
  moveIndex.value = i
  moveOpen.value = true
}

/** 视觉对齐弹窗的显隐与目标动作下标（-1 = 从未打开过）。 */
const tfOpen = ref(false)
const tfIndex = ref(-1)

function openTransform(i: number) {
  tfIndex.value = i
  tfOpen.value = true
}

/** 是否配过视觉对齐：非默认值时在入口旁显示当前值摘要。 */
function isAligned(a: ActionRow): boolean {
  return a.offsetX !== 0 || a.offsetY !== 0 || a.scale !== 1 || a.flip
}

/** 测试播放：广播 pet-play-action（用 key 播放），提示用名称展示。 */
async function testPlay(key: string, label: string) {
  if (!key) return
  try {
    await emitEvent('pet-play-action', key)
    ElMessage.success(`已通知主窗播放「${label}」`)
  } catch (e) {
    ElMessage.error(`测试播放失败：${e}`)
  }
}
</script>

<style>
.block__title {
  font-weight: 600;
}
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

:deep(.el-card__header) {
  padding: 10px 18px;
}
:deep(.el-card__body) {
  padding: 10px 18px;
}

/* collapse 标题栏灰色背景 */
:deep(.el-collapse-item__header) {
  --el-collapse-header-height: 40px;
  background: var(--el-fill-color-light);
  padding: 0 12px;
}
:deep(.el-collapse-item__wrap) {
  padding: 10px 12px;
}
:deep(.el-collapse-item__content) {
  padding-bottom: 0px;
}

.item__name {
  font-weight: 600;
  display: inline-block;
}
.item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.item__btn {
  margin-left: auto;
  margin-right: 10px;
}
.item__btn + .item__btn {
  margin-left: 0;
  margin-right: 18px;
}
.hint {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
