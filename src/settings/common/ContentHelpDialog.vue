<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    :width="width"
    class="content-help"
    align-center
  >
    <div v-loading="loading" class="content-help__body">
      <el-empty v-if="error" :description="error" :image-size="80" />
      <MdPreview
        v-else-if="md"
        id="content-help-preview"
        :model-value="md"
        preview-theme="cyanosis"
        code-theme="atom"
      />
      <el-empty v-else description="暂无说明内容" :image-size="80" />
    </div>

    <template #footer>
      <el-button type="primary" @click="visible = false">朕知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { MdPreview } from "md-editor-v3";
import "md-editor-v3/lib/preview.css";

interface ContentItem {
  key: string;
  title: string;
  content: string;
  description?: string;
}

const props = withDefaults(
  defineProps<{
    /** 后台说明 key，对应 server/api/contents/[key].get.ts。 */
    contentKey: string;
    /** 弹窗标题；不传则使用后台返回标题。 */
    title?: string;
    /** 弹窗宽度。 */
    width?: string;
    /** 说明服务基址；桌面 WebView 不能使用相对 /api，默认走线上服务。 */
    baseUrl?: string;
  }>(),
  { width: "760px", baseUrl: "https://wuguanwen.cn:10000" },
);

const visible = defineModel<boolean>({ required: true });
const loading = ref(false);
const error = ref("");
const item = ref<ContentItem | null>(null);

const md = computed(() => item.value?.content ?? "");
const dialogTitle = computed(() => props.title || item.value?.title || "使用说明");

async function loadContent() {
  if (!props.contentKey) return;
  loading.value = true;
  error.value = "";
  try {
    item.value = await fetchContent(props.contentKey);
  } catch {
    item.value = null;
    error.value = "说明加载失败，请稍后再试";
  } finally {
    loading.value = false;
  }
}

async function fetchContent(key: string): Promise<ContentItem> {
  const base = props.baseUrl.replace(/\/$/, "");
  const resp = await fetch(`${base}/api/contents/${encodeURIComponent(key)}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as ContentItem;
}

watch(visible, (v) => {
  if (v) void loadContent();
});
</script>

<style scoped lang="scss">
.content-help {
  .content-help__body {
    min-height: 180px;
    max-height: 62vh;
    overflow-y: auto;
    padding-right: 4px;
  }
}
</style>
