<template>
  <div class="shortcut-settings">
    <!-- 顶部工具条 -->
    <header class="topbar">
      <div class="topbar__left">
        <span class="topbar__title">快捷键设置</span>
      </div>
      <div class="topbar__btns">
        <el-button :icon="Refresh" @click="resetDefaults">恢复默认</el-button>
        <el-button type="primary" :icon="Check" @click="save">保存</el-button>
      </div>
    </header>

    <main class="shortcut-settings__body">
      <el-card shadow="never" class="block">
        <el-empty
          v-if="shortcuts.length === 0"
          description="暂无快捷键配置"
          :image-size="64"
        />
        <div v-else class="shortcut-list">
          <div v-for="(s, i) in shortcuts" :key="s.id" class="shortcut-row">
            <span class="shortcut-row__name">{{ s.name }}</span>
            <el-tag
              :type="s.scope === 'global' ? 'warning' : 'info'"
              size="small"
              effect="plain"
              class="shortcut-row__scope"
            >
              {{ s.scope === "global" ? "🌐 全局" : "🏠 应用内" }}
            </el-tag>
            <span class="shortcut-row__desc">{{ s.description }}</span>
            <div
              class="shortcut-row__input"
              :class="{
                'shortcut-row__input--recording': recordingIndex === i,
                'shortcut-row__input--conflict':
                  conflictIds.has(s.id) || externalIds.has(s.id),
              }"
              :title="
                externalIds.has(s.id) ? '该组合键可能被其他程序占用，请更换' : ''
              "
              tabindex="0"
              @keydown.prevent.stop="(e) => onKeyDown(e, i)"
              @focus="recordingIndex = i"
              @blur="recordingIndex = -1"
            >
              <span v-if="recordingIndex === i" class="recording-hint">
                按键盘设置快捷键
              </span>
              <template v-else-if="s.key">{{ formatKey(s.key) }}</template>
              <span v-else class="placeholder">点击输入快捷键</span>
              <el-button
                v-if="s.key && recordingIndex !== i"
                text
                :icon="Close"
                class="clear-btn"
                @click.stop="clearKey(i)"
              />
            </div>
          </div>
        </div>
        <div class="hint-block">
          <p>💡 点击快捷键输入框后按下组合键即可绑定，按 Backspace 清空。</p>
          <p>💡 支持的修饰键：Ctrl、Shift、Alt。修改后请点「保存」生效。</p>
          <p>
            🌐 全局键在任何程序活跃时都生效，可能与其他软件冲突；冲突会标红，换一个即可。
          </p>
          <p>🏠 应用内键仅在桌宠主窗口聚焦时生效。</p>
        </div>
      </el-card>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { Refresh, Check, Close } from "@element-plus/icons-vue";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import {
  SHORTCUT_DEFS,
  SHORTCUTS_CHANGED_EVENT,
  SHORTCUTS_RESULT_EVENT,
  type ShortcutResult,
  type ShortcutScope,
  loadShortcutMap,
  saveShortcutMap,
  serializeKeyEvent,
  formatKey,
} from "../composables/useShortcuts";

/** 设置页里一行可编辑的快捷键。 */
interface ShortcutRow {
  id: string;
  name: string;
  description: string;
  scope: ShortcutScope;
  /** 绑定的按键串（内部格式，如 "Alt+Z"），空串表示未绑定。 */
  key: string;
}

const shortcuts = ref<ShortcutRow[]>([]);
const recordingIndex = ref(-1);
/** 内部冲突：同一组合键绑给了多条功能。 */
const conflictIds = ref<Set<string>>(new Set());
/** 外部冲突：全局键被其他程序占用（由主窗注册失败回传）。 */
const externalIds = ref<Set<string>>(new Set());

/** 从共享模块加载配置，构建可编辑行。 */
function loadShortcuts() {
  const map = loadShortcutMap();
  shortcuts.value = SHORTCUT_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    scope: d.scope,
    key: map[d.id] ?? "",
  }));
  checkConflicts();
}

/** 持久化到 localStorage 并广播变更，主窗收到后重新注册/应用。 */
function save() {
  const map: Record<string, string> = {};
  for (const s of shortcuts.value) map[s.id] = s.key;
  saveShortcutMap(map);
  // 广播让主窗重新应用；主窗会回传被占用的全局键，由 SHORTCUTS_RESULT_EVENT 接收。
  emit(SHORTCUTS_CHANGED_EVENT).catch(() => {});
  ElMessage.success("快捷键已保存");
}

/** 恢复为内置默认按键（尚未保存）。 */
function resetDefaults() {
  shortcuts.value = SHORTCUT_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    scope: d.scope,
    key: d.defaultKey,
  }));
  checkConflicts();
  ElMessage.info("已恢复默认（尚未保存）");
}

/** 检测并标记内部冲突（相同 key 的非空项）。 */
function checkConflicts() {
  const keyMap = new Map<string, string[]>();
  for (const s of shortcuts.value) {
    if (!s.key) continue;
    const arr = keyMap.get(s.key) ?? [];
    arr.push(s.id);
    keyMap.set(s.key, arr);
  }
  const conflicts = new Set<string>();
  for (const [, ids] of keyMap) {
    if (ids.length > 1) {
      for (const id of ids) conflicts.add(id);
    }
  }
  conflictIds.value = conflicts;
}

/** 清空某一项的绑定。 */
function clearKey(index: number) {
  shortcuts.value[index].key = "";
  externalIds.value.delete(shortcuts.value[index].id);
  checkConflicts();
}

/**
 * 录制按键：把组合键序列化成 "Ctrl+Shift+A" 这类字符串。
 * Escape 取消录制；Backspace / Delete 清空；纯修饰键忽略。
 */
function onKeyDown(e: KeyboardEvent, index: number) {
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
  shortcuts.value[index].key = serialized;
  // 改了键，先清掉这条的「外部占用」标记，等下次保存重新判定。
  externalIds.value.delete(shortcuts.value[index].id);
  checkConflicts();
  recordingIndex.value = -1;
}

let unlistenResult: UnlistenFn | undefined;

onMounted(async () => {
  loadShortcuts();
  // 监听主窗回传的注册结果，标记被其他程序占用的全局键。
  try {
    unlistenResult = await listen<ShortcutResult>(
      SHORTCUTS_RESULT_EVENT,
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
  // 让主窗按当前已保存配置应用一次并回传占用情况，打开设置即可看到冲突状态。
  emit(SHORTCUTS_CHANGED_EVENT).catch(() => {});
});

onUnmounted(() => unlistenResult?.());
</script>

<style scoped>
.shortcut-settings {
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
.topbar__btns {
  flex: none;
  display: flex;
  gap: 8px;
}

.shortcut-settings__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block__title {
  font-weight: 600;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.shortcut-row__name {
  flex: none;
  width: 60px;
  font-weight: 600;
  font-size: 14px;
}

.shortcut-row__scope {
  flex: none;
}

.shortcut-row__desc {
  flex: 1;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.shortcut-row__input {
  flex: none;
  width: 140px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  outline: none;
}
.shortcut-row__input:hover {
  border-color: var(--el-border-color-hover);
}
.shortcut-row__input:focus,
.shortcut-row__input--recording {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7);
}
.shortcut-row__input--conflict {
  border-color: var(--el-color-danger);
  box-shadow: 0 0 0 1px var(--el-color-danger-light-7);
}

.shortcut-row__input kbd {
  display: inline-block;
  padding: 2px 8px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color-darker);
  border-radius: 4px;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.06);
}

.placeholder {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

/* 录制中（输入框聚焦）：提示「按键盘设置快捷键」，蓝色突出。 */
.recording-hint {
  color: var(--el-color-primary);
  font-size: 13px;
}

.clear-btn {
  padding: 2px 4px;
  height: auto;
}

.hint-block {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.hint-block p {
  margin: 0;
}
</style>
