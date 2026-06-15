<template>
  <div class="menu" @click.stop>
    <div class="menu__header">
      <span>多多</span>
      <div
        class="menu__close"
        role="button"
        tabindex="0"
        aria-label="关闭"
        @mousedown.stop.prevent="emit('close')"
      >
        ×
      </div>
    </div>

    <div class="menu__row menu__row--slider" @click.stop>
      <span class="menu__row-label">📏 大小</span>
      <!-- 拖动时由 el-slider 自带的 tooltip 显示当前倍数（formatSize 格式化为 "1.0x"）。 -->
      <el-slider
        class="menu__slider"
        :model-value="size"
        :min="0.2"
        :max="2"
        :step="0.05"
        :format-tooltip="formatSize"
        @input="onSizeInput"
      />
    </div>

    <div class="menu__row menu__row--slider" @click.stop>
      <span class="menu__row-label">🌫️ 透明</span>
      <!-- 透明度最小保留 10%，避免误拖到完全看不见。 -->
      <el-slider
        class="menu__slider"
        :model-value="opacity"
        :min="0.1"
        :max="1"
        :step="0.05"
        :format-tooltip="formatOpacity"
        @input="onOpacityInput"
      />
    </div>

    <div class="menu__row menu__row--toggle" @click.stop>
      <span>👀 偷看</span>
      <el-switch :model-value="follow" @change="onToggleChange" />
    </div>

    <div class="menu__row menu__row--toggle" @click.stop>
      <span>🖱️ 穿透点击</span>
      <el-switch :model-value="passthrough" @change="onPassthroughChange" />
    </div>

    <div class="menu__actions">
      <!-- 加个提示，否则用户不知道「校准猫头」是做什么的。 -->
      <el-tooltip
        content="拖动圆圈对准猫咪头部，校准视线死区，让跟随光标更准"
        placement="bottom"
        :teleported="false"
        :show-after="200"
      >
        <el-button text class="menu__btn" @click="emit('calibrate')"
          >🎯 校准猫头</el-button
        >
      </el-tooltip>
      <el-button text class="menu__btn menu__btn--warn" @click="emit('boss')">
        🏃 老板来了
      </el-button>
      <el-button text class="menu__btn menu__btn--danger" @click="emit('quit')">
        👋 下班！！
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  size: number;
  opacity: number;
  follow: boolean;
  passthrough: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:size", value: number): void;
  (e: "update:opacity", value: number): void;
  (e: "update:follow", value: boolean): void;
  (e: "update:passthrough", value: boolean): void;
  (e: "calibrate"): void;
  (e: "boss"): void;
  (e: "sleep"): void;
  (e: "feed"): void;
  (e: "quit"): void;
}>();

function onSizeInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) emit("update:size", v);
}

function onOpacityInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) emit("update:opacity", v);
}

/** 格式化大小滑块 tooltip 文本，如 1x / 0.25x。步长 0.05，最多两位小数并去掉尾随 0。 */
function formatSize(value: number): string {
  return `${Number(value.toFixed(2))}x`;
}

/** 格式化透明度滑块 tooltip 文本，如 85%。 */
function formatOpacity(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function onToggleChange(value: string | number | boolean) {
  emit("update:follow", Boolean(value));
}

function onPassthroughChange(value: string | number | boolean) {
  emit("update:passthrough", Boolean(value));
}
</script>

<style scoped>
.menu {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  /* 背景：底部一只小猫脸水印（icon.png）+ 整面半透明深色叠加层，保证文字可读。 */
  background-color: rgba(28, 28, 30, 0.92);
  background-image: linear-gradient(rgba(28, 28, 30, 0.5), rgba(28, 28, 30, 0.7)),
    url("../../assets/icon.png");
  background-repeat: no-repeat, no-repeat;
  /* 叠加层铺满；猫脸缩小并贴到底部居中。 */
  background-position: center, center bottom;
  background-size: cover, auto 150px;
  color: #f0f0f0;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  font-size: 13px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-family: -apple-system, "Microsoft YaHei", "Segoe UI", sans-serif;
}

.menu__header {
  padding: 6px 6px 6px 14px;
  font-size: 11px;
  color: #888;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.menu__close {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: #888;
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  user-select: none;
  outline: none;
}

.menu__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.menu__close:active {
  background: rgba(255, 255, 255, 0.15);
}

.menu__row {
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.08s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu__row:hover {
  background: rgba(255, 255, 255, 0.07);
}

/* 大小行：单行左右布局——标签靠左，滑块占满剩余宽度。 */
.menu__row--slider {
  align-items: center;
  gap: 12px;
  cursor: default;
}

.menu__row--slider:hover {
  background: transparent;
}

.menu__row-label {
  flex: none;
  /* 最小宽度，避免标签与滑块贴在一起。 */
  min-width: 56px;
  font-size: 13px;
}

.menu__slider {
  flex: 1;
  /* 留出右侧余量，避免最大值时滑块手柄贴到行边缘。 */
  margin-right: 4px;
}

.menu__row--toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  cursor: default;
}

.menu__row--toggle:hover {
  background: transparent;
}

/* Element Plus 开关 —— 深色玻璃质感主题 */
.menu__row--toggle :deep(.el-switch) {
  --el-switch-off-color: rgba(255, 255, 255, 0.15);
  --el-switch-on-color: #4a9eff;
  height: 18px;
}

.menu__actions {
  display: flex;
  flex-direction: column;
  margin-top: 4px;
}

.menu__actions :deep(.el-button.menu__btn) {
  justify-content: flex-start;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 8px 14px;
  border-radius: 0;
  color: #f0f0f0;
  font-size: 13px;
  font-family: inherit;
}

.menu__actions :deep(.el-button.menu__btn:hover) {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.menu__actions :deep(.el-button.menu__btn--warn) {
  color: #ffa726;
}

.menu__actions :deep(.el-button.menu__btn--warn:hover) {
  background: rgba(255, 167, 38, 0.12);
  color: #ffa726;
}

.menu__actions :deep(.el-button.menu__btn--danger) {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  color: #ff8a80;
}

.menu__actions :deep(.el-button.menu__btn--danger:hover) {
  background: rgba(255, 100, 100, 0.12);
  color: #ff8a80;
}
</style>
