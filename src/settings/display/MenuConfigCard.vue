<template>
  <div class="menu-config">
    <p class="menu-config__tip">
      为猫爪菜单的 5 个爪垫分别选择功能，并可自定义显示名称。4 个趾建议 4 字以内
      （每行 2 字、最多 2 行），掌垫可放 6 字（单行）。右键小猫即可看到猫爪造型菜单。
    </p>

    <div class="menu-config__slots">
      <div v-for="(slot, i) in PAW_SLOTS" :key="slot.key" class="menu-config__slot">
        <span class="menu-config__slot-icon">🐾</span>
        <span class="menu-config__slot-label">{{ slot.label }}</span>
        <el-select
          :model-value="menuSettings[i]?.actionId"
          @update:model-value="(val: string) => onSlotChange(i, val)"
          size="small"
          class="menu-config__select"
          clearable
          placeholder="未绑定"
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
        <el-input
          :model-value="menuSettings[i]?.label"
          @update:model-value="(val: string) => onLabelChange(i, val)"
          size="small"
          :maxlength="slot.key === 'center-pad' ? 6 : 4"
          placeholder="显示名称"
          class="menu-config__name"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  menuSettings,
  PAW_SLOTS,
  menuItemId,
  saveAndBroadcast,
} from "../../pet-core/menuSettings";
import { BUILTIN_ACTIONS, findBuiltin } from "../../pet-core/commands";
import {
  loadManifestNames,
  type ManifestNameItem,
} from "../../pet-core/manifestCatalog";

/** manifest 动作 / 行为条目（设置窗异步读取）。 */
const actionItems = ref<ManifestNameItem[]>([]);
const behaviorItems = ref<ManifestNameItem[]>([]);

/** 内置组：过滤掉「打开菜单」（在菜单里点没意义）。 */
const builtinOpts = computed(() =>
  BUILTIN_ACTIONS.filter((b) => b.key !== "openMenu").map((b) => ({
    id: b.key,
    label: b.standardLabel,
    emoji: b.emoji,
  })),
);

/** 动作组：manifest 动作 + 随机动作。 */
const actionOpts = computed(() => [
  ...actionItems.value.map((item) => ({
    id: `action:${item.key}`,
    label: item.label,
    emoji: "🎬",
  })),
  { id: "randomAction", label: "随机动作", emoji: "🎲" },
]);

/** 行为组：manifest 行为 + 随机行为。 */
const behaviorOpts = computed(() => [
  ...behaviorItems.value.map((item) => ({
    id: `behavior:${item.key}`,
    label: item.label,
    emoji: "🐾",
  })),
  { id: "randomBehavior", label: "随机行为", emoji: "🎲" },
]);

/** 替换第 i 个槽位的菜单项（按选中 actionId 构造，emoji 反查目录）。 */
function onSlotChange(index: number, actionId: string) {
  const next = [...menuSettings.value];
  next[index] = {
    id: menuItemId(actionId),
    actionId,
    emoji: emojiFor(actionId),
    label: labelFor(actionId),
  };
  menuSettings.value = next;
  saveAndBroadcast();
}

/** 修改第 i 个槽位的显示名称（只改 label，不动 actionId）。 */
function onLabelChange(index: number, label: string) {
  const cur = menuSettings.value[index];
  if (!cur) return;
  const next = [...menuSettings.value];
  next[index] = { ...cur, label };
  menuSettings.value = next;
  saveAndBroadcast();
}

/** 由 actionId 推导默认 emoji。 */
function emojiFor(id: string): string {
  const b = findBuiltin(id);
  if (b) return b.emoji;
  if (id.startsWith("action:")) return "🎬";
  if (id.startsWith("behavior:")) return "🐾";
  if (id === "randomAction" || id === "randomBehavior") return "🎲";
  return "🎬";
}

/** 由 actionId 推导默认显示名（首次选中时填入，用户可改）。 */
function labelFor(id: string): string {
  const b = findBuiltin(id);
  if (b) return b.menuLabel;
  if (id.startsWith("action:")) {
    const key = id.slice("action:".length);
    return actionItems.value.find((item) => item.key === key)?.label ?? key;
  }
  if (id.startsWith("behavior:")) {
    const key = id.slice("behavior:".length);
    return behaviorItems.value.find((item) => item.key === key)?.label ?? key;
  }
  if (id === "randomAction") return "随机动作";
  if (id === "randomBehavior") return "随机行为";
  return "";
}

/** 读取 manifest 动作 / 行为条目，供下拉「动作」/「行为」组使用。 */
async function loadCatalog() {
  const names = await loadManifestNames();
  actionItems.value = names.actions;
  behaviorItems.value = names.behaviors;
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

.menu-config__name {
  width: 110px;
  flex-shrink: 0;
}
</style>
