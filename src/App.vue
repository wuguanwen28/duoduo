<template>
  <!-- 资源就绪才挂载 <Pet>，确保 useCatBrain/useGaze 实例化时模型已加载。
       加载中：透明空窗，不显示任何内容。
       加载失败 / 缺资源：显示引导卡片。 -->
  <Pet v-if="status === 'ready'" />
  <MissingResources
    v-else-if="status === 'error'"
    :message="errorMsg"
    :root="root"
    @retry="boot"
  />
</template>

<script lang="ts" setup>
import { onMounted, ref } from "vue";
import Pet from "./components/Pet/Pet.vue";
import MissingResources from "./components/MissingResources/MissingResources.vue";
import { loadResources, getResourceRoot } from "./resources/store";

/** 启动状态：加载中 / 就绪 / 失败。 */
const status = ref<"loading" | "ready" | "error">("loading");
/** 失败时的错误说明（来自后端或解析）。 */
const errorMsg = ref("");
/** 资源根目录绝对路径（引导卡片里告诉用户该往哪放素材）。 */
const root = ref("");

/** 加载外置资源；成功挂载宠物，失败转引导态。 */
async function boot() {
  status.value = "loading";
  const r = await loadResources();
  root.value = getResourceRoot();
  if (r.ok) {
    status.value = "ready";
  } else {
    errorMsg.value = r.error ?? "未知错误";
    status.value = "error";
  }
}

onMounted(boot);
</script>

<style scoped></style>
