<template>
  <div class="update-settings">
    <!-- 顶部工具条，与设置页其他子页面保持统一 -->
    <header class="topbar">
      <div class="topbar__left">
        <span class="topbar__title">关于 / 更新</span>
      </div>
    </header>

    <main class="update-settings__body">
      <!-- 品牌卡片：应用信息 + 操作按钮 -->
      <el-card shadow="never" class="block">
        <div class="update-card">
          <div class="update-card__brand">
            <img :src="appIcon" class="update-card__icon" alt="应用图标" />
            <div class="update-card__meta">
              <div class="update-card__name">多多</div>
              <div class="update-card__version">版本 v{{ current || "…" }}</div>
            </div>
          </div>

          <div class="update-card__actions">
            <el-button class="action-btn" @click="openUrl(GITEE_URL)">
              <template #icon>
                <img :src="giteeIcon" class="action-btn__icon" alt="" />
              </template>
              Gitee
            </el-button>
            <el-button class="action-btn" @click="openUrl(GITHUB_URL)">
              <template #icon>
                <img :src="githubIcon" class="action-btn__icon" alt="" />
              </template>
              GitHub
            </el-button>
            <el-button class="action-btn" @click="feedbackVisible = true">
              <template #icon>
                <span style="font-size: 16px">💬</span>
              </template>
              意见反馈
            </el-button>
            <el-button
              type="primary"
              :icon="primaryIcon"
              :loading="checking || downloading"
              :disabled="primaryDisabled"
              @click="onPrimaryAction"
            >
              {{ primaryText }}
            </el-button>
          </div>
        </div>

        <!-- 下载进度 + 取消按钮 -->
        <div v-if="downloading || progress > 0" class="update-progress-row">
          <el-progress
            :percentage="progress"
            :status="progress === 100 ? 'success' : undefined"
            class="update-progress"
          />
          <el-tooltip v-if="downloading" content="取消下载" placement="top">
            <el-button
              type="danger"
              text
              circle
              :icon="Close"
              :loading="cancelling"
              @click="onCancel"
            />
          </el-tooltip>
        </div>

        <!-- 新版本提示横幅 -->
        <div v-if="hasUpdate && !downloadedPath" class="new-version-banner">
          检测到新版本：{{ latest }}
        </div>
      </el-card>

      <!-- 富文本更新说明：后端接口返回 HTML 后在此渲染 -->
      <!-- <el-card shadow="never" class="block">
        <div class="rich-notes">
          <div class="rich-notes__title">更新说明</div>
          <div v-if="notes" class="rich-notes__body" v-html="notes" />
          <div v-else class="rich-notes__empty">暂无更新说明</div>
        </div>
      </el-card> -->
    </main>

    <FeedbackDialog v-model="feedbackVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Download, RefreshRight, Close } from "@element-plus/icons-vue";
import githubIcon from "../../assets/github.svg";
import giteeIcon from "../../assets/gitee.svg";
import FeedbackDialog from "./FeedbackDialog.vue";

/** 应用图标（与 BasicSettings 共用同一份默认图标资源）。 */
const appIcon = new URL("../../assets/icon.png", import.meta.url).href;

/** 仓库与联系信息常量。 */
const GITHUB_URL = "https://github.com/wuguanwen28/duoduo";
const GITEE_URL = "https://gitee.com/wuguanwen28/duoduo";

/**
 * 用系统默认程序打开外部链接（浏览器 / 邮件客户端）。
 * Tauri webview 默认不外跳，交由后端 pet_open_url 调用系统命令打开。
 */
async function openUrl(url: string) {
  try {
    await invoke("pet_open_url", { url });
  } catch (e) {
    ElMessage.error(`打开链接失败：${e}`);
  }
}

/** 后端 pet_update_check 的返回结构。 */
interface CheckResult {
  hasUpdate: boolean;
  current: string;
  latest: string;
  notes: string;
}

/** 后端 pet_update_last_result 的返回结构（只读缓存，不发网络请求）。 */
interface LastCheckResult {
  result: CheckResult | null;
  checkedAtMs: number | null;
}

const current = ref("");
const latest = ref("");
const notes = ref("");
const hasUpdate = ref(false);
const checking = ref(false);
const downloading = ref(false);
const cancelling = ref(false);
const progress = ref(0);
const downloadedPath = ref("");
const currentDownloadId = ref(0);

/** 反馈弹窗显隐（托盘「意见反馈」经 open-feedback 事件打开）。 */
const feedbackVisible = ref(false);

/** 主按钮文案：根据当前状态在「检查中 / 下载中 / 更新到 / 安装并重启 / 检查更新」之间切换。 */
const primaryText = computed(() => {
  if (downloadedPath.value) return "立即安装并重启";
  if (downloading.value) return "下载中...";
  if (checking.value) return "检查中...";
  if (hasUpdate.value) return `更新到 v${latest.value}`;
  return "检查更新";
});

/** 主按钮图标：默认显示搜索，有更新时显示下载，已下载时显示重启。 */
const primaryIcon = computed(() => {
  if (downloadedPath.value) return RefreshRight;
  if (hasUpdate.value && !downloading.value && !checking.value) return Download;
  if (!downloading.value && !checking.value) return RefreshRight;
  return undefined;
});

/** 主按钮禁用：只在检查 / 下载过程中禁用；无更新时允许点击重新检查。 */
const primaryDisabled = computed(() => checking.value || downloading.value);

/** 主按钮点击：根据当前状态分发检查 / 下载 / 安装。 */
async function onPrimaryAction() {
  if (downloadedPath.value) {
    await onApply();
  } else if (hasUpdate.value) {
    await onDownload();
  } else {
    await onCheck();
  }
}

/** 手动或自动检查更新。 */
async function onCheck() {
  checking.value = true;
  try {
    const r = await invoke<CheckResult>("pet_update_check");
    current.value = r.current;
    latest.value = r.latest;
    notes.value = r.notes;
    hasUpdate.value = r.hasUpdate;
    if (!r.hasUpdate) {
      ElMessage.success("已是最新版本");
    }
  } catch (e) {
    ElMessage.error(`检查失败：${e}`);
  } finally {
    checking.value = false;
  }
}

/** 页面打开时读一次后台轮询缓存；不发请求，切标签页/重开设置页都不会触发新检查。 */
async function loadCachedResult() {
  try {
    const r = await invoke<LastCheckResult>("pet_update_last_result");
    if (r.result) {
      latest.value = r.result.latest;
      notes.value = r.result.notes;
      hasUpdate.value = r.result.hasUpdate;
    }
  } catch {
    // 静默：缓存还未就绪时保持初始空状态，按钮仍可手动点「检查更新」。
  }
}

/** 后端 pet_update_download 的返回结构。 */
interface DownloadResult {
  path: string;
  downloadId: number;
}

/** 后端 pet_update_status 的返回结构。 */
interface DownloadState {
  isDownloading: boolean;
  downloadId: number;
  progress: number;
  downloadedPath: string;
  latestVersion: string;
}

/** 下载新版本（进度由 update://progress 事件驱动）。 */
async function onDownload() {
  downloading.value = true;
  progress.value = 0;
  currentDownloadId.value = 0;
  try {
    const r = await invoke<DownloadResult>("pet_update_download");
    downloadedPath.value = r.path;
    currentDownloadId.value = r.downloadId;
    progress.value = 100;
    ElMessage.success("下载完成，可安装重启");
  } catch (e) {
    const msg = String(e);
    if (msg.includes("取消")) {
      ElMessage.info("下载已取消");
    } else {
      ElMessage.error(`下载失败：${e}`);
    }
    progress.value = 0;
    currentDownloadId.value = 0;
  } finally {
    downloading.value = false;
  }
}

/** 取消正在进行的下载。 */
async function onCancel() {
  cancelling.value = true;
  try {
    await invoke("pet_update_cancel");
  } catch (e) {
    ElMessage.error(`取消失败：${e}`);
  } finally {
    cancelling.value = false;
  }
}

/** 安装并重启。 */
async function onApply() {
  try {
    await invoke("pet_update_apply");
  } catch (e) {
    ElMessage.error(`安装失败：${e}`);
  }
}

/** 监听下载进度事件。 */
let unlisten: UnlistenFn | undefined;
/** 监听下载开始事件，用于获取本次下载 id。 */
let unlistenStart: UnlistenFn | undefined;
/** 监听下载完成事件，设置窗口打开时下载完毕可立即显示安装按钮。 */
let unlistenCompleted: UnlistenFn | undefined;
/** 监听托盘「意见反馈」事件，自动打开反馈弹窗。 */
let unlistenFeedback: UnlistenFn | undefined;

/** 从后端恢复之前的下载状态（支持关闭窗口后后台下载）。 */
async function restoreDownloadState() {
  try {
    const s = await invoke<DownloadState>("pet_update_status");
    downloading.value = s.isDownloading;
    progress.value = s.progress;
    downloadedPath.value = s.downloadedPath;
    currentDownloadId.value = s.downloadId;
    // 若后端已记住新版本号但前端尚未检查，用它补全提示。
    if (s.latestVersion && !latest.value) {
      latest.value = s.latestVersion;
      hasUpdate.value = true;
    }
  } catch {
    // 查询失败不影响主流程。
  }
}

onMounted(async () => {
  // 版本号是编译进 exe 的常量（纯本地、零网络），先秒填出来，
  // 这样即便后面的网络检查慢或失败，「当前版本」也始终可见。
  try {
    current.value = await invoke<string>("pet_app_version");
  } catch {
    // 取本地版本理论上不会失败；万一失败留空，由 onCheck 兜底。
  }
  await loadCachedResult();
  await restoreDownloadState();

  unlisten = await listen<{
    downloaded: number;
    total: number;
    downloadId: number;
  }>("update://progress", (e) => {
    // 组件已卸载、下载已被取消，或事件来自旧任务时，忽略迟到进度事件。
    if (!downloading.value) return;
    if (e.payload.downloadId !== currentDownloadId.value) return;
    const { downloaded, total } = e.payload;
    if (total > 0) progress.value = Math.floor((downloaded / total) * 100);
  });
  unlistenStart = await listen<{ downloadId: number }>(
    "update://started",
    (e) => {
      currentDownloadId.value = e.payload.downloadId;
    },
  );
  unlistenCompleted = await listen<{ path: string }>(
    "update://completed",
    (e) => {
      downloading.value = false;
      downloadedPath.value = e.payload.path;
      progress.value = 100;
      ElMessage.success("下载完成，可安装重启");
    },
  );
  unlistenFeedback = await listen("open-feedback", () => {
    feedbackVisible.value = true;
  });
});
onUnmounted(() => {
  unlisten?.();
  unlistenStart?.();
  unlistenCompleted?.();
  unlistenFeedback?.();
  // 关闭设置窗口不再取消下载，允许后台继续下载；下次打开通过 pet_update_status 恢复状态。
});
</script>

<style scoped lang="scss">
.update-settings {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  height: 54px;
  box-sizing: border-box;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-light);
  position: sticky;
  top: 0;
  z-index: 10;
}
.topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.topbar__title {
  font-size: 16px;
  font-weight: 600;
}

.update-settings__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.update-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.update-card__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.update-card__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.update-card__name {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.update-card__version {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.2;
}

.update-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.action-btn__icon {
  width: 16px;
  height: 16px;
}

.update-progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.update-progress {
  flex: 1;

  :deep(.el-progress__text) {
    text-align: center;
  }
}

.new-version-banner {
  padding: 12px 16px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.4;
  margin-top: 16px;
}

.rich-notes__title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--el-text-color-primary);
}

.rich-notes__body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-regular);

  :deep(h1),
  :deep(h2),
  :deep(h3) {
    margin: 16px 0 8px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  :deep(h1) {
    font-size: 16px;
  }

  :deep(h2) {
    font-size: 15px;
  }

  :deep(h3) {
    font-size: 14px;
  }

  :deep(p) {
    margin: 8px 0;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 20px;
    margin: 8px 0;
  }

  :deep(li) {
    margin: 4px 0;
  }

  :deep(a) {
    color: var(--el-color-primary);
    text-decoration: none;
  }

  :deep(a:hover) {
    text-decoration: underline;
  }

  :deep(code) {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    background: var(--el-fill-color-light);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
  }

  :deep(pre) {
    background: var(--el-fill-color-light);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 8px 0;
  }

  :deep(pre code) {
    background: transparent;
    padding: 0;
  }

  :deep(blockquote) {
    margin: 8px 0;
    padding: 8px 12px;
    border-left: 4px solid var(--el-border-color);
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
  }

  :deep(img) {
    max-width: 100%;
    border-radius: 8px;
    margin: 8px 0;
  }
}

.rich-notes__empty {
  font-size: 14px;
  color: var(--el-text-color-placeholder);
  text-align: center;
  padding: 24px 0;
}
</style>
