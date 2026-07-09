<script setup lang="ts">
/**
 * 选猫器：header 里「当前猫」按钮 + 选择弹窗的合体组件。
 *
 * 按钮显示当前猫头像/名字，点击弹出选择列表；选中后调用全局 `switchCat`
 * 切换当前编辑的猫，再 emit `change(id)` 供页面做后续副作用（如
 * DisplaySettings 需重载触发器绑定行）。
 *
 * 当前猫、头像、名字都从 appSettings 全局单例直接读取，故无需页面透传 props。
 */
import { ref, computed, watch } from "vue";
import { ArrowDown, Check } from "@element-plus/icons-vue";
import {
  currentCatId,
  globalSettings,
  avatarUrl,
  avatarAssetUrl,
  switchCat,
  listCats,
  type CatEntry,
} from "../../pet-core/appSettings";

const emit = defineEmits<{
  /** 切猫完成后触发，携带新猫 id，供页面重载各自的按猫状态。 */
  change: [string];
}>();

/** 弹窗显隐。 */
const open = ref(false);
/** 当前猫名字；未命名/无配置时回退空串（按钮内以「选择小猫」兜底）。 */
const currentCatName = computed(
  () => globalSettings.value?.cats[currentCatId.value]?.name ?? "",
);

// ── 弹窗内的猫列表 ──
const cats = ref<CatEntry[]>([]);
// 打开时刷新猫列表。
watch(open, async (v) => {
  if (v) cats.value = await listCats();
});

/** 默认头像：项目内置 icon.png。 */
const defaultAvatar = new URL("../../assets/icon.png", import.meta.url).href;
function avatarSrc(cat: CatEntry): string {
  // 经 avatarAssetUrl 统一附加破缓存令牌，与卡片/编辑预览一致。
  return cat.avatarUrl ? avatarAssetUrl(cat.avatarUrl) : defaultAvatar;
}

async function onPick(id: string) {
  open.value = false;
  await switchCat(id);
  emit("change", id);
}
</script>

<template>
  <el-button class="cat-picker-btn" size="small" @click="open = true">
    <div class="cat-picker-btn__content">
      <img
        v-if="avatarUrl"
        :src="avatarUrl"
        class="cat-picker-btn__avatar"
        alt=""
      />
      <span>{{ currentCatName || "选择小猫" }}</span>
      <el-icon><ArrowDown /></el-icon>
    </div>
  </el-button>

  <el-dialog v-model="open" title="选择小猫" width="360px">
    <div class="cat-picker">
      <div
        v-for="cat in cats"
        :key="cat.id"
        class="cat-picker__item"
        :class="{ 'cat-picker__item--active': cat.id === currentCatId }"
        @click="onPick(cat.id)"
      >
        <img class="cat-picker__avatar" :src="avatarSrc(cat)" alt="" />
        <span class="cat-picker__name">{{ cat.name || "未命名" }}</span>
        <el-icon v-if="cat.id === currentCatId" class="cat-picker__check"
          ><Check
        /></el-icon>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped lang="scss">
.cat-picker-btn {
  margin-left: 4px;
  height: 32px;
  border-radius: 16px;

  &__content {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}
.cat-picker-btn__avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

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
