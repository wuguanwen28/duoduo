<template>
  <div class="display-settings">
    <!-- 顶部工具条 -->
    <SettingsHeader title="显示与交互">
      <template #left>
        <!-- 选猫：切换当前正在编辑的小猫（大小/透明度/触发器等按猫独立） -->
        <CatPicker />
      </template>
    </SettingsHeader>

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
            <span class="display-settings__hint">{{
              formatOpacity(opacity)
            }}</span>
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

          <el-form-item label="跟随光标">
            <el-switch :model-value="follow" @change="onFollowChange" />
            <span class="display-settings__switch-desc">
              开启后猫咪头部会跟随鼠标转动（关闭则不偷看）
            </span>
          </el-form-item>

          <el-form-item label="猫头校准">
            <el-button :icon="Aim" @click="onCalibrate">校准猫头</el-button>
            <span class="display-settings__switch-desc">
              点击后到猫咪窗口拖动圆圈对准猫头，确定注视原点
            </span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 触发器配置：鼠标手势 + 键盘快捷键合并为一张表。
           前4行鼠标（触发只读、仅改动作），后续快捷键行（录制/动作/全局开关/删除）。
           全局键编辑时实时探测占用，冲突即报红；修改后自动持久化并广播生效。 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="display-settings__card-header">
            <span class="display-settings__card-title">🖱️ 触发器</span>
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
                'trigger-row__input--clearable':
                  b.trigger && recordingIndex !== i,
              }"
              :title="
                externalIds.has(b.id)
                  ? '该组合键可能被其他程序占用，请更换'
                  : ''
              "
              tabindex="0"
              @keydown.prevent.stop="(e) => onKeydown(e, i)"
              @focus="recordingIndex = i"
              @blur="recordingIndex = -1"
            >
              <span v-if="recordingIndex === i" class="recording-hint">
                按键盘设置快捷键
              </span>
              <template v-else-if="b.trigger">{{
                formatKey(b.trigger)
              }}</template>
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
              @change="persist"
              clearable
              placeholder="未绑定"
              :fallback-placements="['top', 'bottom']"
            >
              <el-option-group label="内置">
                <el-option
                  v-for="opt in builtinOpts"
                  :key="opt.id"
                  :label="opt.label"
                  :value="opt.id"
                />
              </el-option-group>
              <el-option-group label="动作">
                <el-option
                  v-for="opt in actionOpts"
                  :key="opt.id"
                  :label="opt.label"
                  :value="opt.id"
                />
              </el-option-group>
              <el-option-group label="行为">
                <el-option
                  v-for="opt in behaviorOpts"
                  :key="opt.id"
                  :label="opt.label"
                  :value="opt.id"
                />
              </el-option-group>
            </el-select>

            <!-- 右侧操作区：配置按钮 + 全局开关 + 删除按钮。
                 鼠标行同样保留此容器，使动作下拉框与快捷键行对齐。 -->
            <div class="trigger-row__actions">
              <el-tooltip
                v-if="b.kind === 'key'"
                :content="
                  b.isGlobal
                    ? '全局快捷键：注册到系统层，窗口不聚焦也能触发'
                    : '应用内快捷键：仅猫咪窗口聚焦时才能触发'
                "
                placement="top"
              >
                <el-button
                  :plain="!b.isGlobal"
                  type="primary"
                  size="small"
                  class="trigger-row__icon-btn"
                  :class="{ 'trigger-row__icon-btn--active': b.isGlobal }"
                  @click="toggleGlobal(i)"
                >
                  <template #icon>
                    <EarthIcon class="trigger-row__earth" />
                  </template>
                </el-button>
              </el-tooltip>

              <el-button
                v-if="b.kind === 'key'"
                plain
                type="danger"
                :icon="Delete"
                size="small"
                class="trigger-row__icon-btn"
                @click="removeBinding(i)"
              />

              <el-tooltip
                v-if="isPhraseAction(b.actionId)"
                content="说话短语设置"
                placement="top"
              >
                <el-button
                  plain
                  type="primary"
                  size="small"
                  class="trigger-row__icon-btn"
                  @click="openPhraseDialog(b)"
                >
                  <template #icon>
                    <ChatLineRound />
                  </template>
                </el-button>
              </el-tooltip>

              <el-tooltip
                v-else-if="isMenuAction(b.actionId)"
                content="菜单内容设置"
                placement="top"
              >
                <el-button
                  plain
                  type="primary"
                  size="small"
                  class="trigger-row__icon-btn"
                  @click="menuDialogVisible = true"
                >
                  <template #icon>
                    <Operation />
                  </template>
                </el-button>
              </el-tooltip>
            </div>
          </div>
        </div>

        <div class="display-settings__trigger-actions">
          <el-button :icon="Plus" @click="addKeyBinding">新增快捷键</el-button>
          <el-button :icon="Refresh" @click="resetDefaults">恢复默认</el-button>
        </div>
      </el-card>
    </main>

    <PhraseConfigDialog
      v-model:visible="phraseDialogVisible"
      v-model:phrases="phraseDialogTarget"
    />
    <MenuConfigDialog v-model:visible="menuDialogVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
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
  TRIGGER_BINDINGS_CHANGED_EVENT,
  TRIGGER_BINDINGS_RESULT_EVENT,
  serializeKeyEvent,
  formatKey,
  toAccelerator,
  type TriggerBinding,
  type TriggerResult,
} from "../../pet-core/triggerBindings";
import { DEFAULT_TRIGGER_BINDINGS } from "../../pet-core/defaults";
import { BUILTIN_ACTIONS, MOUSE_TRIGGER_LABELS } from "../../pet-core/commands";
import { Aim } from "@element-plus/icons-vue";
import { invoke } from "@tauri-apps/api/core";
import {
  currentCatId,
  follow,
  startCalibrate,
} from "../../pet-core/appSettings";
import CatPicker from "../common/CatPicker.vue";
import SettingsHeader from "../common/SettingsHeader.vue";

// ── 切猫回调：CatPicker 选猫 / cat-loaded 事件（打开设置页激活、增删猫）触发 ──
// 重新加载触发器绑定行 + 该猫的 manifest 动作/行为下拉（manifest 按猫独立）。
function onCatChange() {
  loadRows();
  loadManifestNames().then((names) => {
    actionItems.value = names.actions;
    behaviorItems.value = names.behaviors;
  });
}

// ── 跟随光标 / 校准 ──
/** 跟随光标开关：改 ref + 走 display 广播（对应猫窗实时生效 + appSettings 监听写盘）。 */
function onFollowChange(value: string | number | boolean) {
  follow.value = Boolean(value);
  saveAndBroadcast();
}
/** 校准猫头：先确保该猫窗已显示，再触发它进入校准模式。 */
async function onCalibrate() {
  await invoke("pet_show_cat_window", { catId: currentCatId.value }).catch(
    () => {},
  );
  startCalibrate();
}
import { defaultSpeakPhrases, type SpeakPhrase } from "../../pet-core/speakPhrases";
import {
  loadManifestNames,
  type ManifestNameItem,
} from "../../pet-core/manifestCatalog";
import {
  Plus,
  Refresh,
  Close,
  Delete,
  ChatLineRound,
  Operation,
} from "@element-plus/icons-vue";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import PhraseConfigDialog from "./PhraseConfigDialog.vue";
import MenuConfigDialog from "./MenuConfigDialog.vue";
import EarthIcon from "./EarthIcon.vue";

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

/** 说话内容弹窗：当前编辑的触发器绑定（TriggerBinding 引用）。 */
const phraseBinding = ref<TriggerBinding | null>(null);

/** 弹窗 phrases 双向绑定代理：读写指向当前绑定的 phrases。
 *  首次打开若无 phrases，用默认模板拷贝初始化。 */
const phraseDialogTarget = computed<SpeakPhrase[]>({
  get: () => {
    const b = phraseBinding.value;
    if (b && !Array.isArray(b.phrases)) {
      b.phrases = defaultSpeakPhrases.value.map((p) => ({ ...p }));
    }
    return b?.phrases ?? [];
  },
  set: (v) => {
    if (phraseBinding.value) {
      phraseBinding.value.phrases = v;
      saveTriggerBindings(rows.value.map((b) => ({ ...b })));
    }
  },
});

/** 打开说话内容弹窗，记录当前编辑的绑定。 */
function openPhraseDialog(b: TriggerBinding) {
  phraseBinding.value = b;
  phraseDialogVisible.value = true;
}

// ── 触发器（鼠标手势 + 快捷键） ────────────────────────────────
/** 触发器可编辑行（基于 TriggerBinding，id 复用）。 */
const rows = ref<TriggerBinding[]>([]);
const recordingIndex = ref(-1);
/** 内部冲突：同一组合键绑给了多条快捷键。 */
const conflictIds = ref<Set<string>>(new Set());
/** 外部冲突：全局键被其他程序占用（实时探测 + 主窗回传）。 */
const externalIds = ref<Set<string>>(new Set());

/** manifest 动作 / 行为条目（设置窗异步读取）。 */
const actionItems = ref<ManifestNameItem[]>([]);
const behaviorItems = ref<ManifestNameItem[]>([]);

/** 内置组：过滤掉「头部校准」（快捷键校准体验差）。 */
const builtinOpts = computed(() =>
  BUILTIN_ACTIONS.filter((b) => b.key !== "calibrate").map((b) => ({
    id: b.key,
    label: b.standardLabel,
  })),
);

/** 动作组：manifest 动作 + 随机动作。 */
const actionOpts = computed(() => [
  ...actionItems.value.map((item) => ({
    id: `action:${item.key}`,
    label: item.label,
  })),
  { id: "randomAction", label: "随机动作" },
]);

/** 行为组：manifest 行为 + 随机行为。 */
const behaviorOpts = computed(() => [
  ...behaviorItems.value.map((item) => ({
    id: `behavior:${item.key}`,
    label: item.label,
  })),
  { id: "randomBehavior", label: "随机行为" },
]);

let unlistenResult: UnlistenFn | undefined;
/** 监听 cat-loaded（loadAppSettings 完成后发），切猫后重载触发器行/动作下拉。 */
let unlistenCatLoaded: UnlistenFn | undefined;

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

/**
 * 持久化当前配置并广播给主窗（立即生效）。
 * 若存在内部冲突，弹警告但仍保存（用户可能正在调整）。
 */
function persist() {
  checkConflicts();
  if (conflictIds.value.size > 0) {
    ElMessage.warning("存在按键冲突，请修正");
  }
  saveTriggerBindings(rows.value.map((b) => ({ ...b })));
  emit(
    TRIGGER_BINDINGS_CHANGED_EVENT,
    rows.value.map((b) => ({ ...b })),
  ).catch(() => {});
}

/** 恢复为内置默认并立即保存。 */
function resetDefaults() {
  rows.value = DEFAULT_TRIGGER_BINDINGS.map((b) => ({ ...b }));
  externalIds.value = new Set();
  persist();
  ElMessage.info("已恢复默认");
}

/** 新增一条空快捷键，默认应用内 / 无动作，自动进入录制并立即保存。 */
function addKeyBinding() {
  rows.value.push({
    id: crypto.randomUUID(),
    kind: "key",
    trigger: "",
    actionId: "",
    isGlobal: false,
  });
  recordingIndex.value = rows.value.length - 1;
  persist();
}

/** 删除指定快捷键行：二次确认后再移除并保存。 */
async function removeBinding(index: number) {
  const b = rows.value[index];
  if (!b) return;
  try {
    await ElMessageBox.confirm(
      `确定要删除快捷键「${b.trigger ? formatKey(b.trigger) : "未绑定"}」吗？`,
      "删除快捷键",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    // 用户取消或关闭弹窗。
    return;
  }
  rows.value.splice(index, 1);
  conflictIds.value.delete(b.id);
  externalIds.value.delete(b.id);
  persist();
}

/** 清空某项按键绑定并立即保存。 */
function clearKey(index: number) {
  rows.value[index].trigger = "";
  externalIds.value.delete(rows.value[index].id);
  persist();
}

/**
 * 录制按键：序列化成 "Ctrl+Shift+A"。
 * Escape 取消录制；Backspace / Delete 清空；纯修饰键忽略。
 * 录制完成后若是全局键，先探测占用再保存；否则直接保存。
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
  recordingIndex.value = -1;
  // 全局键：探测占用后再持久化；应用内键直接持久化。
  const b = rows.value[index];
  if (b.kind === "key" && b.isGlobal) {
    void probeAndMark(b).then(persist);
  } else {
    persist();
  }
}

/** 切换快捷键作用域（全局 / 应用内）。 */
function toggleGlobal(index: number) {
  const b = rows.value[index];
  if (b.kind !== "key") return;
  b.isGlobal = !b.isGlobal;
  onScopeChange(index);
}

/** 作用域切换：切到全局时探测占用后再保存；切回应用内直接保存。 */
function onScopeChange(index: number) {
  const b = rows.value[index];
  if (b.kind === "key" && b.isGlobal) {
    void probeAndMark(b).then(persist);
  } else {
    externalIds.value.delete(b.id);
    persist();
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
  loadManifestNames().then((names) => {
    actionItems.value = names.actions;
    behaviorItems.value = names.behaviors;
  });
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
  try {
    // 切猫后（loadAppSettings 完成、triggerBindings 已 hydrate）重载触发器行与动作下拉。
    unlistenCatLoaded = await listen("cat-loaded", () => onCatChange());
  } catch {
    // 忽略——事件绑定不可用。
  }
  // 让主窗按当前已保存配置应用一次并回传占用情况。
  emit(
    TRIGGER_BINDINGS_CHANGED_EVENT,
    rows.value.map((b) => ({ ...b })),
  ).catch(() => {});
});

onUnmounted(() => {
  unlistenResult?.();
  unlistenCatLoaded?.();
});

/**
 * 滑块拖动时：更新本地 ref + 广播（主窗实时响应），
 * 等 @change（松手）时广播最终值（持久化由 appSettings 监听后写盘）。
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

/* 触发器行：flex 布局，右侧操作区固定宽度，保证鼠标行与快捷键行的动作下拉框对齐。 */
.trigger-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

/* 鼠标标签：与快捷键输入框 trigger-row__input 共用一套「按钮」外观
   （等宽、同边框/圆角/内边距/白底），区别仅在于文字居中且无删除按钮、不可交互。 */
.trigger-row__mouse-label {
  flex: none;
  width: 160px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: #fff;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.trigger-row__input {
  position: relative;
  flex: none;
  width: 160px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  outline: none;
  box-sizing: border-box;
}

/* 可清空时增大右侧内边距，避免文字与清除按钮重叠。 */
.trigger-row__input--clearable {
  padding-right: 26px;
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
  min-width: 0;
}

/* 右侧操作区：固定宽度，内部靠右排列，保证各行动作下拉框右边界对齐。 */
.trigger-row__actions {
  flex: none;
  width: 100px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
}

/* 图标按钮：统一 28px，无边框。 */
.trigger-row__icon-btn {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;

  + .el-button {
    margin-left: 0px;
  }
}

/* 图标按钮高亮：全局开启时。 */
.trigger-row__icon-btn--active {
  color: #fff;
}

/* 地球图标：填充满按钮。 */
.trigger-row__earth {
  width: 16px;
  height: 16px;
}

.placeholder {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.recording-hint {
  color: var(--el-color-primary);
  font-size: 13px;
}

/* 删除按钮绝对定位到框右侧，使框内文字保持居中。 */
.clear-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  padding: 2px 4px;
  height: auto;
}

.display-settings__trigger-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
