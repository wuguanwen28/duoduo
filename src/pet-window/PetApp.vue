<template>
  <!-- 资源就绪才挂载 <Pet>，确保 useCatBrain/useGaze 实例化时模型已加载。
       petKey 自增可强制重挂宠物，用于保存 manifest 后的热重载。
       加载失败 / 缺资源：显示引导卡片。 -->
  <Pet v-if="status === 'ready'" :key="petKey" />
  <MissingResources
    v-else-if="status === 'error'"
    :message="errorMsg"
    :root="root"
    @retry="boot"
  />
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Pet from "./components/Pet/Pet.vue";
import MissingResources from "./components/MissingResources/MissingResources.vue";
import { loadResources, getResourceRoot } from "../pet-core/resources";

/** 启动状态：加载中 / 就绪 / 失败。 */
const status = ref<"loading" | "ready" | "error">("loading");
/** 失败时的错误说明（来自后端或解析）。 */
const errorMsg = ref("");
/** 资源根目录绝对路径（引导卡片里告诉用户该往哪放素材）。 */
const root = ref("");
/** 自增以强制重挂 <Pet>，让 useCatBrain/useGaze 用新模型重建（热重载用）。 */
const petKey = ref(0);

/** 加载外置资源；成功挂载/重挂宠物，失败转引导态。 */
async function boot() {
  // 首次（尚未就绪）显示加载态；热重载时保持当前画面，加载完再平滑重挂。
  if (status.value !== "ready") status.value = "loading";
  const r = await loadResources();
  root.value = getResourceRoot();
  if (r.ok) {
    petKey.value++;
    status.value = "ready";
  } else {
    errorMsg.value = r.error ?? "未知错误";
    status.value = "error";
  }
}

let unlisten: UnlistenFn | undefined;

onMounted(async () => {
  await boot();
  // 设置窗保存 manifest 后广播 manifest-updated，主窗据此热重载资源并重挂宠物。
  try {
    unlisten = await listen("manifest-updated", () => {
      void boot();
    });
  } catch {
    // 事件不可用——忽略。
  }
});

onUnmounted(() => unlisten?.());
</script>

<style>
/* 全局透明 —— 只有宠物精灵可见。 */
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent !important;
  overflow: hidden;
  /* 透明区域上的点击会穿透到窗口背后的应用程序。
     可交互的子元素（猫的图像、菜单、校准浮层）会在局部重新启用
     pointer-events。键盘事件（Esc）不受影响。 */
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
</style>
