/**
 * 猫选择弹窗：列出所有猫（头像+名字），选一只 → emit pick(id)。
 * 供资源/交互设置 header 切换当前编辑的猫。
 */
<template>
  <el-dialog v-model="visible" title="选择小猫" width="360px">
    <div class="cat-picker">
      <div
        v-for="cat in cats"
        :key="cat.id"
        class="cat-picker__item"
        :class="{ 'cat-picker__item--active': cat.id === selectedId }"
        @click="onPick(cat.id)"
      >
        <img class="cat-picker__avatar" :src="avatarSrc(cat)" alt="" />
        <span class="cat-picker__name">{{ cat.name || "未命名" }}</span>
        <el-icon v-if="cat.id === selectedId" class="cat-picker__check"><Check /></el-icon>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Check } from "@element-plus/icons-vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listCats, type CatEntry } from "../../pet-core/appSettings";

const props = defineProps<{ modelValue: boolean; currentId: string }>();
const emit = defineEmits<{
  "update:modelValue": [boolean];
  pick: [string];
}>();

const visible = ref(props.modelValue);
watch(() => props.modelValue, (v) => {
  visible.value = v;
});
watch(visible, (v) => emit("update:modelValue", v));

const cats = ref<CatEntry[]>([]);
const selectedId = ref(props.currentId);
watch(() => props.currentId, (v) => {
  selectedId.value = v;
});

// 打开时刷新猫列表 + 同步选中。
watch(visible, async (v) => {
  if (v) {
    cats.value = await listCats();
    selectedId.value = props.currentId;
  }
});

/** 默认头像：项目内置 icon.png。 */
const defaultAvatar = new URL("../../assets/icon.png", import.meta.url).href;
function avatarSrc(cat: CatEntry): string {
  return cat.avatarUrl ? convertFileSrc(cat.avatarUrl) : defaultAvatar;
}

function onPick(id: string) {
  emit("pick", id);
  visible.value = false;
}
</script>

<style scoped>
.cat-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cat-picker__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.cat-picker__item:hover {
  background: var(--el-fill-color-light);
}
.cat-picker__item--active {
  background: var(--el-color-primary-light-9);
}
.cat-picker__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--el-border-color-light);
}
.cat-picker__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-picker__check {
  color: var(--el-color-primary);
}
</style>
