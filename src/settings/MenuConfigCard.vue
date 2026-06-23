<template>
  <div class="menu-config">
    <p class="menu-config__tip">
      为猫爪菜单的 5 个爪垫分别选择功能。右键小猫即可看到猫爪造型菜单。
    </p>

    <div class="menu-config__slots">
      <div v-for="(slot, i) in PAW_SLOTS" :key="slot.key" class="menu-config__slot">
        <span class="menu-config__slot-icon">🐾</span>
        <span class="menu-config__slot-label">{{ slot.label }}</span>
        <el-select
          :model-value="menuSettings[i]"
          @update:model-value="(val: MenuItemConfig) => onSlotChange(i, val)"
          value-key="id"
          size="small"
          class="menu-config__select"
        >
          <el-option
            v-for="opt in allOptions"
            :key="opt.id"
            :label="`${opt.emoji} ${opt.label}`"
            :value="opt"
          />
        </el-select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  menuSettings,
  PAW_SLOTS,
  BUILTIN_CATALOG,
  menuItemId,
  type MenuItemConfig,
} from "../composables/useMenuSettings";

/**
 * 所有可选功能：内置功能 + manifest 动作 + manifest 行为。
 * 每个选项是一个完整的 MenuItemConfig，下拉框显示 "emoji label"。
 */
const actionOpts = ref<MenuItemConfig[]>([]);
const behaviorOpts = ref<MenuItemConfig[]>([]);

const builtinOpts = computed<MenuItemConfig[]>(() =>
  BUILTIN_CATALOG.map((b) => ({
    id: menuItemId("builtin", b.ref),
    kind: "builtin" as const,
    ref: b.ref,
    emoji: b.emoji,
    label: b.label,
  })),
);

const allOptions = computed<MenuItemConfig[]>(() => [
  ...builtinOpts.value,
  ...behaviorOpts.value,
  ...actionOpts.value,
]);

/** 替换第 i 个槽位的菜单项（展开去代理后触发响应式更新与持久化）。 */
function onSlotChange(index: number, val: MenuItemConfig) {
  const copy = { ...val };
  copy.id = menuItemId(copy.kind, copy.ref);
  const next = [...menuSettings.value];
  next[index] = copy;
  menuSettings.value = next;
}

/**
 * 读取 manifest.json，解析出所有动作名与行为名作为下拉可选池。
 * 设置窗口是独立 webview，用 pet_read_manifest 拿到 manifest 文本再解析。
 */
async function loadCatalog() {
  try {
    const r = await invoke<{ content: string; exists: boolean }>(
      "pet_read_manifest",
    );
    if (!r.exists || !r.content.trim()) return;
    const m = JSON.parse(r.content);

    const acts = m.actions ?? {};
    actionOpts.value = Object.keys(acts).map((name) => ({
      id: menuItemId("action", name),
      kind: "action" as const,
      ref: name,
      emoji: "🎬",
      label: typeof acts[name]?.name === "string" && acts[name].name ? acts[name].name : name,
    }));

    const behs = m.behaviors ?? {};
    behaviorOpts.value = Object.keys(behs).map((name) => ({
      id: menuItemId("behavior", name),
      kind: "behavior" as const,
      ref: name,
      emoji: "🐾",
      label: typeof behs[name]?.name === "string" && behs[name].name ? behs[name].name : name,
    }));
  } catch {
    // 读不到 manifest 时可选池只剩内置功能，不阻塞。
  }
}

onMounted(loadCatalog);
</script>

<style scoped>
.menu-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.menu-config__tip {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.menu-config__slots {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.menu-config__slot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.menu-config__slot-icon {
  font-size: 18px;
}

.menu-config__slot-label {
  width: 56px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  flex-shrink: 0;
}

.menu-config__select {
  flex: 1;
  min-width: 0;
}
</style>
