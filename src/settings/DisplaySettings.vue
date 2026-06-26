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
              :step="0.01"
              :format-tooltip="formatSize"
              @input="onSizeInput"
              @change="onSizeChange"
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
              @change="onOpacityChange"
            />
            <span class="display-settings__hint">{{ formatOpacity(opacity) }}</span>
          </el-form-item>

          <el-form-item label="窗口层级">
            <el-switch
              :model-value="alwaysOnTop"
              @change="onAlwaysOnTopChange"
            />
            <span class="display-settings__switch-desc">
              开启后猫咪窗口始终固定在所有窗口最上层
            </span>
          </el-form-item>

          <el-form-item label="点击穿透">
            <el-switch
              :model-value="passthrough"
              @change="onPassthroughChange"
            />
            <span class="display-settings__switch-desc">
              开启后窗口整体穿透，按住 Ctrl 可临时恢复交互
            </span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 手势配置：左键单击 / 双击 / 右键 / 长按分别绑定什么动作。
           选中「说话 / 戳一下并说话 / 打开菜单」时右侧出现设置图标，
           点击打开对应弹窗。 -->
      <el-card shadow="never" class="block">
        <template #header>
          <span class="display-settings__card-title">🖱️ 点击设置</span>
        </template>
        <el-form label-width="92px" label-position="left">
          <el-form-item label="左键单击">
            <div class="display-settings__gesture-row">
              <el-select
                class="display-settings__gesture-select"
                v-model="gestureConfig.leftClick"
                @change="onGestureChange"
              >
                <el-option
                  v-for="key in actionKeys"
                  :key="key"
                  :label="ACTION_LABELS[key] ?? key"
                  :value="key"
                />
              </el-select>
              <div class="display-settings__gesture-icon">
                <el-button
                  v-if="isPhraseAction(gestureConfig.leftClick)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="phraseDialogVisible = true"
                />
                <el-button
                  v-else-if="isMenuAction(gestureConfig.leftClick)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="menuDialogVisible = true"
                />
              </div>
            </div>
          </el-form-item>

          <el-form-item label="左键双击">
            <div class="display-settings__gesture-row">
              <el-select
                class="display-settings__gesture-select"
                v-model="gestureConfig.doubleClick"
                @change="onGestureChange"
              >
                <el-option
                  v-for="key in actionKeys"
                  :key="key"
                  :label="ACTION_LABELS[key] ?? key"
                  :value="key"
                />
              </el-select>
              <div class="display-settings__gesture-icon">
                <el-button
                  v-if="isPhraseAction(gestureConfig.doubleClick)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="phraseDialogVisible = true"
                />
                <el-button
                  v-else-if="isMenuAction(gestureConfig.doubleClick)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="menuDialogVisible = true"
                />
              </div>
            </div>
          </el-form-item>

          <el-form-item label="右键">
            <div class="display-settings__gesture-row">
              <el-select
                class="display-settings__gesture-select"
                v-model="gestureConfig.rightClick"
                @change="onGestureChange"
              >
                <el-option
                  v-for="key in actionKeys"
                  :key="key"
                  :label="ACTION_LABELS[key] ?? key"
                  :value="key"
                />
              </el-select>
              <div class="display-settings__gesture-icon">
                <el-button
                  v-if="isPhraseAction(gestureConfig.rightClick)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="phraseDialogVisible = true"
                />
                <el-button
                  v-else-if="isMenuAction(gestureConfig.rightClick)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="menuDialogVisible = true"
                />
              </div>
            </div>
          </el-form-item>

          <el-form-item label="长按">
            <div class="display-settings__gesture-row">
              <el-select
                class="display-settings__gesture-select"
                v-model="gestureConfig.longPress"
                @change="onGestureChange"
              >
                <el-option
                  v-for="key in actionKeys"
                  :key="key"
                  :label="ACTION_LABELS[key] ?? key"
                  :value="key"
                />
              </el-select>
              <div class="display-settings__gesture-icon">
                <el-button
                  v-if="isPhraseAction(gestureConfig.longPress)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="phraseDialogVisible = true"
                />
                <el-button
                  v-else-if="isMenuAction(gestureConfig.longPress)"
                  type="primary"
                  text
                  :icon="Setting"
                  @click="menuDialogVisible = true"
                />
              </div>
            </div>
          </el-form-item>
        </el-form>
      </el-card>
    </main>

    <PhraseConfigDialog v-model:visible="phraseDialogVisible" />
    <MenuConfigDialog v-model:visible="menuDialogVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  size,
  opacity,
  alwaysOnTop,
  passthrough,
  broadcast,
  saveAndBroadcast,
} from "../composables/useDisplaySettings";
import {
  gestureConfig,
  saveGestureConfig,
} from "../composables/useGestureConfig";
import {
  ACTION_LABELS,
  GESTURE_ACTION_KEYS,
} from "../composables/usePetActions";
import { Setting } from "@element-plus/icons-vue";
import PhraseConfigDialog from "./PhraseConfigDialog.vue";
import MenuConfigDialog from "./MenuConfigDialog.vue";

/** 格式化大小滑块 tooltip 文本，如 1x / 0.25x。 */
function formatSize(value: number): string {
  return `${Number(value.toFixed(2))}x`;
}

/** 格式化透明度滑块 tooltip 文本，如 85%。 */
function formatOpacity(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 可在手势配置中绑定的所有动作 key。 */
const actionKeys = GESTURE_ACTION_KEYS;

/** 说话内容 / 菜单配置弹窗显隐。 */
const phraseDialogVisible = ref(false);
const menuDialogVisible = ref(false);

/** 是否为需要配置说话短语的动作。 */
function isPhraseAction(action: string): boolean {
  return action === "speak" || action === "pokeAndSpeak";
}

/** 是否为需要配置右键菜单的动作。 */
function isMenuAction(action: string): boolean {
  return action === "openMenu";
}

/**
 * 滑块拖动时：更新本地 ref + 广播（主窗实时响应），
 * 等 @change（松手）时才持久化到 localStorage。
 */
function onSizeInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) {
    size.value = v;
    broadcast();
  }
}

function onSizeChange() {
  saveAndBroadcast();
}

function onOpacityInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) {
    opacity.value = v;
    broadcast();
  }
}

function onOpacityChange() {
  saveAndBroadcast();
}

function onAlwaysOnTopChange(value: string | number | boolean) {
  alwaysOnTop.value = Boolean(value);
  saveAndBroadcast();
}

function onPassthroughChange(value: string | number | boolean) {
  passthrough.value = Boolean(value);
  saveAndBroadcast();
}

/** 手势配置变更：持久化并广播给主窗实时生效。 */
function onGestureChange() {
  saveGestureConfig({ ...gestureConfig.value });
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

.display-settings__select {
  flex: 1;
}

.display-settings__gesture-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.display-settings__gesture-select {
  flex: 1;
}

.display-settings__gesture-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.display-settings__switch-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.display-settings__hint {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* 卡片标题 */
.display-settings__card-title {
  font-weight: 600;
}
</style>
