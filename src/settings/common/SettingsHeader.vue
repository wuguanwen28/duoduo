<script setup lang="ts">
/**
 * 设置页统一顶部工具条。
 *
 * 各子页面（基础/显示/资源/工具/更新）此前各自手写 header，高度、内边距、
 * 对齐方式略有出入；此组件统一为 54px 高、贴顶 sticky 的标准样式。
 *
 * - `title`：左侧标题文字。
 * - `left` 插槽：标题右侧的附加内容（如选猫按钮、已保存指示、副标题提示）。
 * - `actions` 插槽：右侧操作按钮区。
 */
defineProps<{
  /** 左侧标题文字 */
  title: string;
}>();
</script>

<template>
  <header class="settings-header">
    <div class="settings-header__left">
      <span class="settings-header__title">{{ title }}</span>
      <!-- 标题右侧附加内容：选猫、已保存提示等 -->
      <slot name="left" />
    </div>
    <!-- 右侧操作按钮区 -->
    <div class="settings-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  height: 54px;
  box-sizing: border-box;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-light);
  position: sticky;
  top: 0;
  z-index: 10;
}
.settings-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.settings-header__title {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}
.settings-header__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
