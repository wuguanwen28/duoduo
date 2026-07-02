<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    :width="width"
    class="content-help"
    center
  >
    <div v-loading="loading" class="content-help__body">
      <el-empty v-if="error" :description="error" :image-size="80" />
      <div v-else-if="html" class="content-help__html" v-html="html" />
      <el-empty v-else description="暂无说明内容" :image-size="80" />
    </div>

    <template #footer>
      <el-button type="primary" @click="visible = false">朕知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

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

const html = computed(() => item.value?.content ?? "");
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
/**
 * 样式尽量贴近 ChromaKeyHelp.vue：小字号长文、主色标题竖条、关键词主色、
 * 列表层次清楚，后台富文本只负责内容，不需要内联大量样式。
 */
.content-help {
  .content-help__body {
    min-height: 180px;
    max-height: 62vh;
    overflow-y: auto;
    padding-right: 4px;
  }

  .content-help__html {
    font-size: 13px;
    line-height: 1.78;
    color: var(--el-text-color-primary);
  }

  .content-help__html :deep(.help-lead) {
    margin: 0 0 18px;
    font-size: 13.5px;
    line-height: 1.78;
    color: var(--el-text-color-primary);
  }

  .content-help__html :deep(h2) {
    margin: 0 0 14px;
    font-size: 18px;
    font-weight: 650;
    color: var(--el-text-color-primary);
  }

  .content-help__html :deep(h3) {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 24px 0 10px;
    padding-bottom: 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    border-bottom: 1px dashed var(--el-border-color-lighter);
  }

  .content-help__html :deep(h3::before) {
    display: block;
    content: "";
    width: 4px;
    height: 22px;
    border-radius: 2px;
    background-color: var(--el-color-primary);
  }

  .content-help__html :deep(.help-lead + h3) {
    margin-top: 8px;
  }

  .content-help__html :deep(p) {
    margin: 6px 0 10px;
    color: var(--el-text-color-regular);
  }

  .content-help__html :deep(b),
  .content-help__html :deep(strong) {
    color: var(--el-color-primary);
    font-weight: normal;
  }

  .content-help__html :deep(ol) {
    counter-reset: help-step;
    list-style: none;
    padding: 0;
    margin: 6px 0 12px;
  }

  .content-help__html :deep(ol > li) {
    position: relative;
    counter-increment: help-step;
    padding-left: 26px;
    margin-bottom: 6px;
    color: var(--el-text-color-regular);
  }

  .content-help__html :deep(ol > li::before) {
    content: counter(help-step);
    position: absolute;
    left: 4px;
    top: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    color: var(--el-color-primary);
  }

  .content-help__html :deep(ul) {
    list-style: none;
    padding: 0;
    margin: 6px 0 12px;
  }

  .content-help__html :deep(ul > li) {
    position: relative;
    padding-left: 18px;
    margin-bottom: 6px;
    color: var(--el-text-color-regular);
  }

  .content-help__html :deep(ul > li::before) {
    content: "";
    position: absolute;
    left: 4px;
    top: 0.78em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background-color: var(--el-color-primary);
  }

  .content-help__html :deep(code) {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
  }

  .content-help__html :deep(pre) {
    padding: 12px;
    overflow-x: auto;
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    color: var(--el-text-color-regular);
  }

  .content-help__html :deep(.help-card) {
    margin: 12px 0;
    padding: 12px 14px;
    border-left: 4px solid var(--el-color-primary);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
  }

  .content-help__html :deep(.help-muted) {
    color: var(--el-text-color-secondary);
    font-style: italic;
  }
}
</style>
