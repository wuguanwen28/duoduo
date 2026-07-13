<template>
  <!--
    自包含的「使用说明」入口：按钮 + 弹窗二合一。
    后台（说明管理）配了该 contentKey 的说明才渲染按钮；
    无网 / 404 / 内容为空时整个组件隐身，天然满足「没说明就不显示」。
  -->
  <template v-if="available">
    <el-button
      plain
      type="primary"
      :icon="QuestionFilled"
      @click="visible = true"
    >
      {{ label }}
    </el-button>

    <el-dialog
      v-model="visible"
      :title="dialogTitle"
      :width="width"
      class="content-help"
      align-center
    >
      <div class="content-help__body">
        <MdPreview
          id="content-help-preview"
          :model-value="md"
          preview-theme="cyanosis"
          code-theme="atom"
        />
      </div>

      <template #footer>
        <el-button type="primary" @click="visible = false">朕知道了</el-button>
      </template>
    </el-dialog>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'

interface ContentItem {
  key: string
  title: string
  content: string
  description?: string
}

const props = withDefaults(
  defineProps<{
    /** 后台说明 key，对应 server/api/contents/[key].get.ts。 */
    contentKey: string
    /** 按钮文字；同一页放多个说明入口时用它区分（如「视频生成说明」）。 */
    label?: string
    /** 弹窗标题；不传则使用后台返回标题。 */
    title?: string
    /** 弹窗宽度。 */
    width?: string
    /** 说明服务基址；桌面 WebView 不能使用相对 /api，默认走线上服务。 */
    baseUrl?: string
  }>(),
  { label: '使用说明', width: '760px', baseUrl: 'https://wuguanwen.cn:10000' },
)

/** 弹窗显隐（组件内部自持，父级只需给 content-key）。 */
const visible = ref(false)
/** 后台说明数据；挂载时静默拉取一次并缓存，打开弹窗直接复用、无需二次请求。 */
const item = ref<ContentItem | null>(null)

/** 是否有可展示的说明：拉取成功且内容非空才为真，决定按钮/弹窗是否渲染。 */
const available = computed(() => !!item.value?.content?.trim())
const md = computed(() => item.value?.content ?? '')
const dialogTitle = computed(
  () => props.title || item.value?.title || '使用说明',
)

/**
 * 挂载时静默探测该 key 是否配了说明：
 * 成功且内容非空 → available 为真，渲染入口；失败 / 空 → 保持隐身，不打扰用户。
 */
async function probeContent() {
  if (!props.contentKey) return
  try {
    item.value = await fetchContent(props.contentKey)
  } catch {
    // 无网 / 404 / 解析失败：静默隐身，不显示按钮。
    item.value = null
  }
}

async function fetchContent(key: string): Promise<ContentItem> {
  const base = props.baseUrl.replace(/\/$/, '')
  const resp = await fetch(`${base}/api/contents/${encodeURIComponent(key)}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as ContentItem
}

onMounted(probeContent)
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
