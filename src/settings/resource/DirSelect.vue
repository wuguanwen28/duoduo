<template>
  <!-- 目录选择器：以资源根为根的树形下拉 + 右侧「选目录」选绝对路径。 -->
  <div class="dir-select">
    <el-tree-select
      :model-value="modelValue"
      :data="mergedTree"
      node-key="value"
      :props="{ label: 'label', children: 'children' }"
      check-strictly
      filterable
      clearable
      :render-after-expand="false"
      :placeholder="placeholder"
      class="dir-select__tree"
      @update:model-value="(v: string) => emit('update:modelValue', v ?? '')"
      @visible-change="onVisibleChange"
    />
    <el-button :icon="FolderOpened" @click="pickAbsolute">选目录</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpened } from '@element-plus/icons-vue'

/** 目录树节点（与后端 `pet_list_dirs` 返回结构一致）。 */
export interface DirNode {
  label: string
  value: string
  children: DirNode[]
}

const props = withDefaults(
  defineProps<{
    /** 当前选中的目录（相对资源根的相对路径，或绝对路径）。 */
    modelValue: string
    /** 资源根下的子目录树。 */
    tree: DirNode[]
    placeholder?: string
  }>(),
  { placeholder: '相对资源根或绝对路径' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  /** 下拉展开时请求父组件刷新目录树（用户可能刚在磁盘上新建了文件夹）。 */
  (e: 'refresh'): void
}>()

/** 下拉展开（v=true）时通知父组件重新拉取目录树。 */
function onVisibleChange(v: boolean) {
  if (v) emit('refresh')
}

/** 深度遍历树，判断某个 value 是否存在于树中。 */
function existsInTree(nodes: DirNode[], value: string): boolean {
  for (const n of nodes) {
    if (n.value === value) return true
    if (n.children?.length && existsInTree(n.children, value)) return true
  }
  return false
}

/**
 * 实际喂给下拉的树数据：当前值（如经「选目录」选了树外的绝对路径）若不在树中，
 * 就把它合成一个顶层节点塞进去，保证下拉框能正常显示该值。
 */
const mergedTree = computed<DirNode[]>(() => {
  const v = props.modelValue
  if (v && !existsInTree(props.tree, v)) {
    return [{ label: v, value: v, children: [] }, ...props.tree]
  }
  return props.tree
})

/** 弹系统目录选择器，选中后作为绝对路径写回（用户取消则忽略）。 */
async function pickAbsolute() {
  try {
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked === 'string') emit('update:modelValue', picked)
  } catch (e) {
    ElMessage.error(`选择目录失败：${e}`)
  }
}
</script>

<style scoped>
.dir-select {
  display: flex;
  width: 100%;
  gap: 0;
}
.dir-select__tree {
  flex: 1;
  min-width: 0;
}
/* 树形下拉与按钮拼成 input-group 观感：中缝合并、不留间隙 */
.dir-select__tree :deep(.el-select__wrapper) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.dir-select .el-button {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  margin-left: -1px;
}
</style>
