<template>
  <div class="update-settings">
    <h2 class="update-settings__title">关于 / 更新</h2>

    <!-- 当前版本 + 检查按钮 -->
    <div class="update-settings__row">
      <span>当前版本：v{{ current || "…" }}</span>
      <el-button
        type="primary"
        :loading="checking"
        :disabled="downloading"
        @click="onCheck"
      >
        检查更新
      </el-button>
      <!-- 状态提示 -->
      <el-alert
        v-if="message"
        :title="message"
        :type="messageType"
        :closable="false"
        show-icon
      />
    </div>

    <!-- 关于信息：作者 / 邮箱 / 仓库地址（链接交给系统默认程序打开） -->
    <dl class="update-settings__about">
      <dt>作者</dt>
      <dd>{{ AUTHOR }}</dd>

      <dt>邮箱</dt>
      <dd>
        <a href="#" @click.prevent="openUrl(`mailto:${EMAIL}`)">{{ EMAIL }}</a>
      </dd>

      <dt>Gitee</dt>
      <dd>
        <a href="#" @click.prevent="openUrl(GITEE_URL)">{{ GITEE_URL }}</a>
      </dd>

      <dt>GitHub</dt>
      <dd>
        <a href="#" @click.prevent="openUrl(GITHUB_URL)">{{ GITHUB_URL }}</a>
      </dd>
    </dl>

    <!-- 反馈入口：问题 / 建议欢迎到任一仓库的 Issues 提出 -->
    <p class="update-settings__feedback">
      如有问题或建议，欢迎到
      <a href="#" @click.prevent="openUrl(`${GITEE_URL}/issues`)">Gitee Issues</a>
      或
      <a href="#" @click.prevent="openUrl(`${GITHUB_URL}/issues`)">GitHub Issues</a>
      提出指导意见。
    </p>

    <!-- 有新版本：说明 + 下载/安装 -->
    <div v-if="latest && hasUpdate" class="update-settings__new">
      <p>发现新版本 v{{ latest }}</p>
      <pre v-if="notes" class="update-settings__notes">{{ notes }}</pre>

      <el-progress
        v-if="downloading || progress > 0"
        :percentage="progress"
        :status="progress === 100 ? 'success' : undefined"
      />

      <el-button
        v-if="!downloadedPath"
        type="success"
        :loading="downloading"
        @click="onDownload"
      >
        下载新版本
      </el-button>
      <el-button v-else type="warning" @click="onApply">
        立即安装并重启
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ElMessage } from "element-plus";

/** 关于信息（硬编码常量）。 */
const AUTHOR = "wuguanwen";
const EMAIL = "513951279@qq.com";
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

const current = ref("");
const latest = ref("");
const notes = ref("");
const hasUpdate = ref(false);
const checking = ref(false);
const downloading = ref(false);
const progress = ref(0);
const downloadedPath = ref("");
const message = ref("");
const messageType = ref<"success" | "info" | "warning" | "error">("info");

/** 手动检查更新。 */
async function onCheck() {
  checking.value = true;
  message.value = "";
  try {
    const r = await invoke<CheckResult>("pet_update_check");
    current.value = r.current;
    latest.value = r.latest;
    notes.value = r.notes;
    hasUpdate.value = r.hasUpdate;
    if (!r.hasUpdate) {
      message.value = "已是最新版本";
      messageType.value = "success";
    }
  } catch (e) {
    message.value = `检查失败：${e}`;
    messageType.value = "error";
  } finally {
    checking.value = false;
  }
}

/** 下载新版本（进度由事件驱动）。 */
async function onDownload() {
  downloading.value = true;
  progress.value = 0;
  message.value = "";
  try {
    downloadedPath.value = await invoke<string>("pet_update_download");
    progress.value = 100;
    message.value = "下载完成，可安装重启";
    messageType.value = "success";
  } catch (e) {
    message.value = `下载失败：${e}`;
    messageType.value = "error";
  } finally {
    downloading.value = false;
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
onMounted(async () => {
  // 版本号是编译进 exe 的常量（纯本地、零网络），先秒填出来，
  // 这样即便后面的网络检查慢或失败，「当前版本」也始终可见。
  try {
    current.value = await invoke<string>("pet_app_version");
  } catch {
    // 取本地版本理论上不会失败；万一失败留空，由 onCheck 兜底。
  }
  await onCheck();
  unlisten = await listen<{ downloaded: number; total: number }>(
    "update://progress",
    (e) => {
      const { downloaded, total } = e.payload;
      if (total > 0) progress.value = Math.floor((downloaded / total) * 100);
    },
  );
});
onUnmounted(() => unlisten?.());
</script>

<style scoped>
.update-settings {
  padding: 20px;
}
.update-settings__title {
  margin: 0 0 16px;
  font-size: 16px;
}
.update-settings__row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;

  span {
    flex-shrink: 0;
  }
}
/* 关于信息：左列标签 + 右列内容的两列网格 */
.update-settings__about {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  margin: 0 0 16px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 13px;
}
.update-settings__about dt {
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.update-settings__about dd {
  margin: 0;
  word-break: break-all;
}
.update-settings__about a {
  color: var(--el-color-primary);
  cursor: pointer;
  text-decoration: none;
}
.update-settings__about a:hover {
  text-decoration: underline;
}
/* 反馈入口：一行说明文字 + 两个 Issues 链接 */
.update-settings__feedback {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
.update-settings__feedback a {
  color: var(--el-color-primary);
  cursor: pointer;
  text-decoration: none;
}
.update-settings__feedback a:hover {
  text-decoration: underline;
}
.update-settings__new {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.update-settings__notes {
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin: 0;
}
</style>
