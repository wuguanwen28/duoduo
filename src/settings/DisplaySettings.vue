<template>
  <div class="display-settings">
    <!-- 顶部工具条 -->
    <header class="topbar">
      <div class="topbar__left">
        <span class="topbar__title">显示设置</span>
      </div>
    </header>

    <main class="display-settings__body">
      <el-card shadow="never" class="block">
        <el-form label-width="92px" label-position="left">
          <el-form-item label="大小">
            <!-- 拖动时由 tooltip 显示当前倍数（格式化为 "1.0x"）。 -->
            <el-slider
              class="display-settings__slider"
              :model-value="size"
              :min="0.2"
              :max="2"
              :step="0.05"
              :format-tooltip="formatSize"
              @input="onSizeInput"
            />
            <span class="display-settings__hint">{{ formatSize(size) }}</span>
          </el-form-item>

          <el-form-item label="透明度">
            <!-- 透明度最小保留 10%，避免误拖到完全看不见。 -->
            <el-slider
              class="display-settings__slider"
              :model-value="opacity"
              :min="0.1"
              :max="1"
              :step="0.05"
              :format-tooltip="formatOpacity"
              @input="onOpacityInput"
            />
            <span class="display-settings__hint">{{ formatOpacity(opacity) }}</span>
          </el-form-item>

          <el-form-item label="窗口层级">
            <div class="display-settings__toggle-row">
              <el-switch
                :model-value="alwaysOnTop"
                @change="onAlwaysOnTopChange"
              />
              <span class="display-settings__toggle-label">
                {{ alwaysOnTop ? "置顶显示" : "跟随普通窗口" }}
              </span>
            </div>
            <div class="display-settings__hint">
              开启后猫咪窗口始终固定在所有窗口最上层
            </div>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 右键菜单配置：选哪些项、拖动排序，决定环形菜单的内容与边数。 -->
      <el-card shadow="never" class="block">
        <template #header>
          <span class="display-settings__card-title">🧭 右键菜单</span>
        </template>
        <MenuConfigCard />
      </el-card>
    </main>
  </div>
</template>

<script setup lang="ts">
import {
  size,
  opacity,
  alwaysOnTop,
} from "../composables/useDisplaySettings";
import MenuConfigCard from "./MenuConfigCard.vue";

/** 格式化大小滑块 tooltip 文本，如 1x / 0.25x。 */
function formatSize(value: number): string {
  return `${Number(value.toFixed(2))}x`;
}

/** 格式化透明度滑块 tooltip 文本，如 85%。 */
function formatOpacity(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function onSizeInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) size.value = v;
}

function onOpacityInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) opacity.value = v;
}

function onAlwaysOnTopChange(value: string | number | boolean) {
  alwaysOnTop.value = Boolean(value);
}
</script>

<style scoped>
.display-settings {
  min-height: 100vh;
}

.topbar {
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

.topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar__title {
  font-size: 16px;
  font-weight: 600;
}

.display-settings__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 滑块行：标签 + 滑块 + 数值，三列布局 */
:deep(.el-form-item__content) {
  display: flex;
  align-items: center;
  gap: 12px;
}

.display-settings__slider {
  flex: 1;
}

.display-settings__hint {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* 开关行 */
.display-settings__toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.display-settings__toggle-label {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

/* 层级行的 hint 独占一行，挂到 form-item 底部 */
:deep(.el-form-item:last-child .el-form-item__content) {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

:deep(.el-form-item:last-child .display-settings__hint) {
  text-align: left;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 卡片标题（右键菜单卡片头部） */
.display-settings__card-title {
  font-weight: 600;
}
</style>
