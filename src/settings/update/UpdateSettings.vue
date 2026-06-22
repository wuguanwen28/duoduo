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
    </div>

    <!-- 状态提示 -->
    <el-alert
      v-if="message"
      :title="message"
      :type="messageType"
      :closable="false"
      show-icon
    />

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
