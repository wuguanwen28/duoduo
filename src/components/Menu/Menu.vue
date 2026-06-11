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
      <div class="menu__row-label">
        <span>大小</span>
        <span class="menu__value">{{ size.toFixed(1) }}x</span>
      </div>
      <el-slider
        class="menu__slider"
        :model-value="size"
        :min="0.5"
        :max="2"
        :step="0.1"
        :show-tooltip="false"
        @input="onSliderInput"
      />
    </div>

    <div class="menu__row menu__row--toggle" @click.stop>
      <span>别偷看</span>
      <el-switch :model-value="follow" @change="onToggleChange" />
    </div>

    <div class="menu__actions">
      <el-button text class="menu__btn" @click="emit('calibrate')"
        >🎯 校准猫头</el-button
      >
      <el-button text class="menu__btn menu__btn--warn" @click="emit('boss')">
        🏃 老板来了
      </el-button>
      <el-button text class="menu__btn" @click="emit('sleep')"
        >😴 睡觉</el-button
      >
      <el-button text class="menu__btn" @click="emit('feed')"
        >🍗 投喂</el-button
      >
      <el-button text class="menu__btn menu__btn--danger" @click="emit('quit')">
        👋 下班！！
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  size: number;
  follow: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:size", value: number): void;
  (e: "update:follow", value: boolean): void;
  (e: "calibrate"): void;
  (e: "boss"): void;
  (e: "sleep"): void;
  (e: "feed"): void;
  (e: "quit"): void;
}>();

function onSliderInput(value: number | number[]) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isNaN(v)) emit("update:size", v);
}

function onToggleChange(value: string | number | boolean) {
  emit("update:follow", Boolean(value));
}
</script>

<style scoped>
.menu {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: rgba(28, 28, 30, 0.94);
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

.menu__row--slider {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  cursor: default;
}

.menu__row--slider:hover {
  background: transparent;
}

.menu__row-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.menu__value {
  font-size: 11px;
  color: #888;
  font-variant-numeric: tabular-nums;
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

/* Element Plus switch — dark glass theme */
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
