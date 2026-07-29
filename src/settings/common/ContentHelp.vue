<template>
  <!--
    自包含的「使用说明」入口：按钮 + 弹窗二合一。两种模式互斥：
    - page 模式：传 page，拉取该页面全部说明，渲染多个按钮（按钮文字=label，空则 title），
      点开共享弹窗显示对应说明。列表为空则整体隐身。
    - contentKey 模式：传 contentKey，拉单条说明，渲染一个按钮；给「别处自定义 key」用。
    page 优先于 contentKey。后台没配说明 / 无网 / 404 / 内容为空时入口隐身，
    天然满足「没说明就不显示」。
  -->
  <!-- page 模式：多个按钮 + 共享弹窗 -->
  <template v-if="mode === 'page' && items.length">
    <el-button
      v-for="item in items"
      :key="item.key"
      plain
      type="primary"
      :icon="QuestionFilled"
      @click="openItem(item)"
    >
      {{ item.label?.trim() || item.title || '使用说明' }}
    </el-button>

    <el-dialog
      v-model="visible"
      :title="current?.title || '使用说明'"
      :width="width"
      class="content-help"
      align-center
    >
      <!-- 事件委托拦截说明内的外链点击：Tauri WebView 默认会在窗口内导航，
           这里改为阻止默认行为、交给后端 pet_open_url 用系统浏览器打开。 -->
      <div class="content-help__body" @click="onBodyClick">
        <MdPreview
          id="content-help-preview"
          :model-value="current?.content ?? ''"
          preview-theme="cyanosis"
          code-theme="atom"
        />
      </div>
      <template #footer>
        <el-button type="primary" @click="visible = false">朕知道了</el-button>
      </template>
    </el-dialog>
  </template>

  <!-- contentKey 模式：单按钮 + 单弹窗 -->
  <template v-else-if="mode === 'key' && available">
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
      <div class="content-help__body" @click="onBodyClick">
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
import { invoke } from '@tauri-apps/api/core'
import { QuestionFilled } from '@element-plus/icons-vue'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import type { ContentPage } from './contentPages'

interface ContentItem {
  key: string
  page?: string | null
  label?: string | null
  title: string
  content: string
  description?: string
}

const props = withDefaults(
  defineProps<{
    /** 页面模式：拉取该 page 下全部说明，渲染多个按钮。与 contentKey 互斥且优先。 */
    page?: ContentPage
    /** 单条模式：按 key 拉取一条说明。给「别处自定义 key」用。 */
    contentKey?: string
    /** 单条模式的按钮文字；同一页放多个说明入口时用它区分。 */
    label?: string
    /** 单条模式的弹窗标题；不传则用后台返回标题。 */
    title?: string
    /** 弹窗宽度。 */
    width?: string
    /** 说明服务基址；桌面 WebView 不能使用相对 /api，默认走线上服务。 */
    baseUrl?: string
  }>(),
  { label: '使用说明', width: '760px', baseUrl: 'https://wuguanwen.cn:10000' },
)

/** 当前模式：传了 page 走列表模式，否则单条模式。 */
const mode = computed<'page' | 'key'>(() => (props.page ? 'page' : 'key'))

/** 弹窗显隐（两种模式共用一个 ref，运行时模式固定不会串扰）。 */
const visible = ref(false)

// —— page 模式状态 ——
/** 该页面下所有说明（已过滤掉内容为空的项）。 */
const items = ref<ContentItem[]>([])
/** 当前在共享弹窗里展示的说明。 */
const current = ref<ContentItem | null>(null)

function openItem(item: ContentItem) {
  current.value = item
  visible.value = true
}

// —— contentKey 模式状态 ——
/** 单条说明数据；挂载时静默拉取一次并缓存。 */
const single = ref<ContentItem | null>(null)
/** 是否有可展示的说明：拉取成功且内容非空才为真，决定按钮/弹窗是否渲染。 */
const available = computed(() => !!single.value?.content?.trim())
const md = computed(() => single.value?.content ?? '')
const dialogTitle = computed(
  () => props.title || single.value?.title || '使用说明',
)

/**
 * 挂载时静默探测：
 * - page 模式：拉该页面全部说明，过滤掉空内容；
 * - contentKey 模式：拉单条。
 * 失败 / 空 -> 保持隐身，不打扰用户。
 */
async function probe() {
  try {
    if (mode.value === 'page' && props.page) {
      const list = await fetchList(props.page)
      items.value = list.filter((i) => i.content?.trim())
    } else if (props.contentKey) {
      single.value = await fetchSingle(props.contentKey)
    }
  } catch {
    // 无网 / 404 / 解析失败：静默隐身，不显示按钮。
    items.value = []
    single.value = null
  }
}

async function fetchList(page: string): Promise<ContentItem[]> {
  const base = props.baseUrl.replace(/\/$/, '')
  const resp = await fetch(
    `${base}/api/contents?page=${encodeURIComponent(page)}`,
  )
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as ContentItem[]
}

async function fetchSingle(key: string): Promise<ContentItem> {
  const base = props.baseUrl.replace(/\/$/, '')
  const resp = await fetch(`${base}/api/contents/${encodeURIComponent(key)}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as ContentItem
}

/**
 * 拦截说明内容里链接的点击：事件委托到内容容器，命中 <a> 后阻止 WebView 内部
 * 导航，改由后端 pet_open_url 调系统默认浏览器打开。仅处理 http(s) 外链，锚点
 * (#) 等交回默认处理。
 */
function onBodyClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  const href = a?.getAttribute('href')
  if (!href || !/^https?:\/\//i.test(href)) return
  e.preventDefault()
  invoke('pet_open_url', { url: href }).catch(() => {})
}

onMounted(probe)
</script>

<style scoped lang="scss">
.content-help {
  .content-help__body {
    min-height: 180px;
    max-height: 62vh;
    overflow-y: auto;
    padding-right: 4px;

    /* 说明里的图片自适应弹窗宽度，避免大图撑破布局或需要横向滚动。
       后台若要单独指定某张图尺寸，可在 markdown 里直接写
       <img src="..." width="300" /> 覆盖此默认。 */
    :deep(img) {
      max-width: 100%;
      height: auto;
    }
  }
}
</style>
