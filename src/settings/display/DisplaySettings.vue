<template>
  <div class="display-settings">
    <!-- 顶部工具条 -->
    <header class="topbar">
      <div class="topbar__left">
        <span class="topbar__title">显示与交互</span>
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

      <!-- 触发器配置：鼠标手势 + 键盘快捷键合并为一张表。
           前4行鼠标（触发只读、仅改动作），后续快捷键行（录制/动作/全局开关/删除）。
           全局键编辑时实时探测占用，冲突即报红；保存后才持久化并广播生效。 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="display-settings__card-header">
            <span class="display-settings__card-title">🖱️ 触发器</span>
            <el-button type="primary" text :icon="Plus" @click="addKeyBinding">
              新增快捷键
            </el-button>
          </div>
        </template>

        <div class="trigger-list">
          <div
            v-for="(b, i) in rows"
            :key="b.id"
            class="trigger-row"
            :class="{ 'trigger-row--mouse': b.kind === 'mouse' }"
          >
            <!-- 触发方式 -->
            <div v-if="b.kind === 'mouse'" class="trigger-row__mouse-label">
              {{ MOUSE_TRIGGER_LABELS[b.trigger] ?? b.trigger }}
            </div>
            <div
              v-else
              class="trigger-row__input"
              :class="{
                'trigger-row__input--recording': recordingIndex === i,
                'trigger-row__input--conflict':
                  conflictIds.has(b.id) || externalIds.has(b.id),
              }"
              :title="
                externalIds.has(b.id) ? '该组合键可能被其他程序占用，请更换' : ''
              "
              tabindex="0"
              @keydown.prevent.stop="(e) => onKeydown(e, i)"
              @focus="recordingIndex = i"
              @blur="recordingIndex = -1"
            >
              <span v-if="recordingIndex === i" class="recording-hint">
                按键盘设置快捷键
              </span>
              <template v-else-if="b.trigger">{{ formatKey(b.trigger) }}</template>
              <span v-else class="placeholder">点击输入快捷键</span>
              <el-button
                v-if="b.trigger && recordingIndex !== i"
                text
                :icon="Close"
                class="clear-btn"
                @click.stop="clearKey(i)"
              />
            </div>

            <!-- 动作下拉 -->
            <el-select
              v-model="b.actionId"
              class="trigger-row__action"
              @change="checkConflicts"
            >
              <el-option
                v-for="key in actionKeysFor(b.kind)"
                :key="key"
                :label="ACTION_LABELS[key] ?? key"
                :value="key"
              />
            </el-select>

            <!-- 说话/菜单配置入口 -->
            <el-button
              v-if="isPhraseAction(b.actionId)"
              text
              :icon="Setting"
              class="display-settings__gesture-icon"
              @click="phraseDialogVisible = true"
            />
            <el-button
              v-if="isMenuAction(b.actionId)"
              text
              :icon="Setting"
              class="display-settings__gesture-icon"
              @click="menuDialogVisible = true"
            />

            <!-- 作用域（仅快捷键） -->
            <el-segmented
              v-if="b.kind === 'key'"
              v-model="b.isGlobal"
              :options="scopeOptions"
              @change="() => onScopeChange(i)"
            />

            <!-- 删除（仅快捷键） -->
            <el-button
              v-if="b.kind === 'key'"
              text
              :icon="Delete"
              @click="removeBinding(i)"
            />
          </div>
        </div>

        <div class="hint-block">
          <p>💡 前 4 行为鼠标手势，触发方式固定，仅可改动作。</p>
          <p>💡 点击按键框后按下组合键即可绑定，按 Backspace 清空。</p>
          <p>🌐 全局键在任何程序活跃时都生效，可能与其他软件冲突；冲突会标红，换一个即可。</p>
          <p>🏠 应用内键仅在桌宠主窗口聚焦时生效。</p>
          <p>修改后请点底部「保存」生效。</p>
        </div>

        <div class="display-settings__trigger-actions">
          <el-button :icon="Refresh" @click="resetDefaults">恢复默认</el-button>
          <el-button type="primary" :icon="Check" @click="save">保存</el-button>
        </div>
      </el-card>
    </main>

    <PhraseConfigDialog v-model:visible="phraseDialogVisible" />
    <MenuConfigDialog v-model:visible="menuDialogVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import {
  size,
  opacity,
  alwaysOnTop,
  passthrough,
  broadcast,
  saveAndBroadcast,
} from "../../pet-core/displaySettings";
import {
  loadTriggerBindings,
  saveTriggerBindings,
  DEFAULT_TRIGGER_BINDINGS,
  TRIGGER_BINDINGS_CHANGED_EVENT,
  TRIGGER_BINDINGS_RESULT_EVENT,
  serializeKeyEvent,
  formatKey,
  toAccelerator,
  type TriggerBinding,
  type TriggerResult,
} from "../../pet-core/triggerBindings";
import {
  ACTION_LABELS,
  GESTURE_ACTION_KEYS,
  SHORTCUT_ACTION_KEYS,
  MOUSE_TRIGGER_LABELS,
} from "../../pet-core/commands";
import { Plus, Refresh, Check, Close, Delete, Setting } from "@element-plus/icons-vue";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { ElMessage } from "element-plus";
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

/** 说话内容 / 菜单配置弹窗显隐。 */
const phraseDialogVisible = ref(false);
const menuDialogVisible = ref(false);

// ── 触发器（鼠标手势 + 快捷键） ────────────────────────────────
/** 触发器可编辑行（基于 TriggerBinding，id 复用）。 */
const rows = ref<TriggerBinding[]>([]);
const recordingIndex = ref(-1);
/** 内部冲突：同一组合键绑给了多条快捷键。 */
const conflictIds = ref<Set<string>>(new Set());
/** 外部冲突：全局键被其他程序占用（实时探测 + 主窗回传）。 */
const externalIds = ref<Set<string>>(new Set());

let unlistenResult: UnlistenFn | undefined;

/** 作用域分段控件选项。`el-segmented` 的 value 用 boolean 绑 isGlobal；
 *  若 vue-tsc 报类型不兼容，改用字符串 "app"/"global" 并在读写处转换。 */
const scopeOptions = [
  { label: "🏠 应用内", value: false },
  { label: "🌐 全局", value: true },
];

/** 按触发类型返回可绑动作白名单。 */
function actionKeysFor(kind: TriggerBinding["kind"]): string[] {
  return kind === "mouse" ? GESTURE_ACTION_KEYS : SHORTCUT_ACTION_KEYS;
}

/** 判断动作是否为说话类动作（需要配置短语）。 */
function isPhraseAction(action: string): boolean {
  return action === "speak" || action === "pokeAndSpeak";
}

/** 判断动作是否为打开菜单动作（需要配置菜单项）。 */
function isMenuAction(action: string): boolean {
  return action === "openMenu";
}

/** 从共享模块加载配置，构建可编辑行。 */
function loadRows() {
  rows.value = loadTriggerBindings().map((b) => ({ ...b }));
  checkConflicts();
}

/**
 * 持久化并广播触发器变更，主窗收到后重新注册 / 应用。
 */
function save() {
  checkConflicts();
  if (conflictIds.value.size > 0) {
    ElMessage.warning("存在按键冲突，请先解决再保存");
    return;
  }
  saveTriggerBindings(rows.value.map((b) => ({ ...b })));
  emit(TRIGGER_BINDINGS_CHANGED_EVENT, rows.value.map((b) => ({ ...b }))).catch(
    () => {},
  );
  ElMessage.success("已保存");
}

/** 恢复为内置默认（尚未保存）。 */
function resetDefaults() {
  rows.value = DEFAULT_TRIGGER_BINDINGS.map((b) => ({ ...b }));
  externalIds.value = new Set();
  checkConflicts();
  ElMessage.info("已恢复默认（尚未保存）");
}

/** 新增一条空快捷键，默认应用内 / 无动作，自动进入录制。 */
function addKeyBinding() {
  rows.value.push({
    id: crypto.randomUUID(),
    kind: "key",
    trigger: "",
    actionId: "none",
    isGlobal: false,
  });
  recordingIndex.value = rows.value.length - 1;
  checkConflicts();
}

/** 删除指定快捷键行。 */
function removeBinding(index: number) {
  const id = rows.value[index]?.id;
  rows.value.splice(index, 1);
  if (id) {
    conflictIds.value.delete(id);
    externalIds.value.delete(id);
  }
  checkConflicts();
}

/** 检测并标记内部冲突（相同非空 key 的项）。 */
function checkConflicts() {
  const keyMap = new Map<string, string[]>();
  for (const b of rows.value) {
    if (b.kind !== "key" || !b.trigger) continue;
    const arr = keyMap.get(b.trigger) ?? [];
    arr.push(b.id);
    keyMap.set(b.trigger, arr);
  }
  const conflicts = new Set<string>();
  for (const [, ids] of keyMap) {
    if (ids.length > 1) for (const id of ids) conflicts.add(id);
  }
  conflictIds.value = conflicts;
}

/** 清空某项按键绑定。 */
function clearKey(index: number) {
  rows.value[index].trigger = "";
  externalIds.value.delete(rows.value[index].id);
  checkConflicts();
}

/**
 * 录制按键：序列化成 "Ctrl+Shift+A"。
 * Escape 取消录制；Backspace / Delete 清空；纯修饰键忽略。
 * 录制完成后若是全局键，立即探测占用。
 */
function onKeydown(e: KeyboardEvent, index: number) {
  if (e.key === "Escape") {
    recordingIndex.value = -1;
    (e.target as HTMLElement)?.blur();
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    clearKey(index);
    return;
  }
  const serialized = serializeKeyEvent(e);
  if (!serialized) return; // 纯修饰键，等待主键
  rows.value[index].trigger = serialized;
  externalIds.value.delete(rows.value[index].id);
  checkConflicts();
  recordingIndex.value = -1;
  // 全局键：录制完成立即探测占用。
  void probeAndMark(rows.value[index]);
}

/** 作用域切换：切到全局时立即探测占用。 */
function onScopeChange(index: number) {
  checkConflicts();
  const b = rows.value[index];
  if (b.kind === "key" && b.isGlobal) {
    void probeAndMark(b);
  } else {
    externalIds.value.delete(b.id);
  }
}

/**
 * 实时探测某条全局键是否被其他程序占用：尝试 register 成功后立即 unregister，
 * 不长期占用、不让草稿提前生效。失败则标红。
 */
async function probeAndMark(b: TriggerBinding): Promise<void> {
  if (b.kind !== "key" || !b.isGlobal || !b.trigger) return;
  const accel = toAccelerator(b.trigger);
  try {
    await register(accel, () => {});
    await unregister(accel);
    externalIds.value.delete(b.id);
  } catch {
    externalIds.value = new Set([...externalIds.value, b.id]);
    ElMessage.error("该组合键可能被其他程序占用，请更换");
  }
}

onMounted(async () => {
  loadRows();
  try {
    unlistenResult = await listen<TriggerResult>(
      TRIGGER_BINDINGS_RESULT_EVENT,
      (ev) => {
        externalIds.value = new Set(ev.payload?.failedIds ?? []);
        if (externalIds.value.size) {
          ElMessage.error("部分全局快捷键可能被其他程序占用（已标红），请更换");
        }
      },
    );
  } catch {
    // 忽略——事件绑定不可用。
  }
  // 让主窗按当前已保存配置应用一次并回传占用情况。
  emit(TRIGGER_BINDINGS_CHANGED_EVENT, rows.value.map((b) => ({ ...b }))).catch(
    () => {},
  );
});

onUnmounted(() => unlistenResult?.());

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

.display-settings__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.trigger-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trigger-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.trigger-row__mouse-label {
  flex: none;
  width: 140px;
  font-weight: 600;
  font-size: 14px;
}

.trigger-row__input {
  flex: none;
  width: 140px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  outline: none;
}
.trigger-row__input:hover {
  border-color: var(--el-border-color-hover);
}
.trigger-row__input:focus,
.trigger-row__input--recording {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7);
}
.trigger-row__input--conflict {
  border-color: var(--el-color-danger);
  box-shadow: 0 0 0 1px var(--el-color-danger-light-7);
}

.trigger-row__action {
  flex: 1;
  min-width: 120px;
}

.placeholder {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.recording-hint {
  color: var(--el-color-primary);
  font-size: 13px;
}

.clear-btn {
  padding: 2px 4px;
  height: auto;
}

.hint-block {
  padding: 12px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.hint-block p {
  margin: 0 0 4px 0;
}

.display-settings__trigger-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
