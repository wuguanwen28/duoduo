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
    <el-collapse v-else v-model="openActions">
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
              测试
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
        <el-form label-width="80px" label-position="right">
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="名称">
                <el-input
                  v-model="a.name"
                  placeholder="动作名称（如 眨眼、摇尾巴）"
                />
              </el-form-item>
            </el-col>
            <el-col :span="16">
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
            <el-col :span="8">
              <el-form-item label="帧率fps">
                <el-input-number
                  v-model="a.fps"
                  :min="1"
                  :max="120"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="来回播放">
                <el-switch v-model="a.yoyo" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="倒放">
                <el-switch v-model="a.reverse" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16" v-if="showTransform">
            <el-col :span="8">
              <el-form-item label="X轴偏移">
                <el-input-number
                  v-model="a.offsetX"
                  :step="0.01"
                  :precision="3"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="Y轴偏移">
                <el-input-number
                  v-model="a.offsetY"
                  :step="0.01"
                  :precision="3"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="缩放">
                <el-input-number
                  v-model="a.scale"
                  :step="0.05"
                  :precision="2"
                  :min="0.1"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { emit as emitEvent } from '@tauri-apps/api/event'
import { Plus, Delete, VideoPlay } from '@element-plus/icons-vue'
import DirSelect, { type DirNode } from './DirSelect.vue'
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

/** 展开的折叠项（默认全展开）。 */
const openActions = ref<number[]>([])

// 列表被整体替换（加载 manifest）时，重置为全部展开；就地增删不在此重置。
watch(
  () => props.actions,
  () => {
    openActions.value = props.actions.map((_, i) => i)
  },
  { immediate: true },
)

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
  })
  openActions.value = [0, ...openActions.value.map((i) => i + 1)]
}

function removeAction(i: number) {
  props.actions.splice(i, 1)
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
</style>
