<template>
  <div class="basic-settings">
    <!-- 顶部工具条 -->
    <header class="topbar">
      <div class="topbar__left">
        <span class="topbar__title">基础设置</span>
      </div>
    </header>

    <main class="basic-settings__body">
      <el-card shadow="never" class="block">
        <el-form label-width="92px" label-position="left">
          <el-form-item label="头像">
            <div class="avatar-row">
              <el-upload
                class="avatar-uploader"
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*"
                @change="onAvatarChange"
              >
                <img
                  v-if="form.avatar || defaultAvatar"
                  :src="form.avatar || defaultAvatar"
                  class="avatar-uploader__img"
                  alt="头像"
                />
                <el-icon v-else class="avatar-uploader__icon"><Plus /></el-icon>
              </el-upload>
              <div class="avatar-actions">
                <el-button text :icon="Monitor" @click="applyAsIcon">
                  设为应用图标
                </el-button>
                <el-button
                  v-if="hasCustomIcon"
                  text
                  type="danger"
                  :icon="Refresh"
                  @click="resetAppIcon"
                  :style="{ marginLeft: 0 }"
                >
                  恢复默认图标
                </el-button>
              </div>
            </div>
          </el-form-item>
          <el-form-item label="名字">
            <el-input
              v-model="form.name"
              placeholder="给你的宠物起个名字"
              maxlength="10"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="出生日期">
            <el-date-picker
              v-model="form.birthday"
              type="date"
              placeholder="选择出生日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              :editable="false"
            />
          </el-form-item>
          <el-form-item label="性别">
            <el-radio-group v-model="form.gender">
              <el-radio-button label="boy">♂ 弟弟</el-radio-button>
              <el-radio-button label="girl">♀ 妹妹</el-radio-button>
              <el-radio-button label="unknown">保密</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </el-card>
    </main>

    <!-- 裁剪对话框 -->
    <el-dialog
      v-model="showCropper"
      title="裁剪头像"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="cropper-wrap">
        <Cropper
          v-if="showCropper"
          ref="cropperRef"
          :src="cropperSrc"
          :stencil-props="{ aspectRatio: 1 }"
          :resize-image="{
            touch: true,
            wheel: { ratio: 0.1 },
          }"
          :auto-zoom="true"
          :default-size="defaultSize"
        />
      </div>
      <template #footer>
        <el-button @click="cancelCrop">取消</el-button>
        <el-button type="primary" @click="confirmCrop">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Plus, Monitor, Refresh } from "@element-plus/icons-vue";
import type { UploadFile } from "element-plus";
import { invoke } from "@tauri-apps/api/core";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import {
  basicSettings,
  saveBasicSettings,
  BASIC_SETTINGS_CHANGED_EVENT,
} from "../composables/useBasicSettings";
import { emit as emitEvent } from "@tauri-apps/api/event";

/** 默认头像：项目内置 icon.png。 */
const defaultAvatar = new URL("../assets/icon.png", import.meta.url).href;

const form = reactive({
  name: basicSettings.value.name,
  avatar: basicSettings.value.avatar,
  birthday: basicSettings.value.birthday,
  gender: basicSettings.value.gender,
});

/** 是否已设置过自定义应用图标（非默认头像）。 */
const hasCustomIcon = computed(() => !!form.avatar);

const showCropper = ref(false);
const cropperSrc = ref("");
const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);

/** el-upload 选择文件后打开裁剪对话框。 */
function onAvatarChange(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    cropperSrc.value = reader.result as string;
    showCropper.value = true;
  };
  reader.readAsDataURL(file);
}

/** 默认裁剪区域大小：占图片的 90%。 */
function defaultSize({
  imageSize,
}: {
  imageSize: { width: number; height: number };
}) {
  return {
    width: Math.min(imageSize.width, imageSize.height) * 0.9,
    height: Math.min(imageSize.width, imageSize.height) * 0.9,
  };
}

/** 取消裁剪，关闭对话框。 */
function cancelCrop() {
  showCropper.value = false;
  cropperSrc.value = "";
}

/** 确认裁剪，输出 128×128 压缩后的 base64。 */
async function confirmCrop() {
  if (!cropperRef.value) return;

  const { canvas } = cropperRef.value.getResult();
  if (!canvas) return;

  // 缩放到 128×128 并编码为 PNG。这里必须用 PNG 而非 JPEG：applyAsIcon 把头像
  // 交给后端 pet_save_icon 设为应用/托盘图标，而 tauri 仅启用了 image-png 特性，
  // Image::from_bytes 只能解码 PNG，JPEG 会解码失败导致「设为图标」无效。
  const target = document.createElement("canvas");
  target.width = 128;
  target.height = 128;
  const ctx = target.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, 128, 128);
  form.avatar = target.toDataURL("image/png");

  showCropper.value = false;
  cropperSrc.value = "";
}

/** 将当前头像设为应用图标。 */
async function applyAsIcon() {
  if (!form.avatar) return;
  try {
    await invoke("pet_save_icon", { data: form.avatar });
    ElMessage.success("应用图标已更新");
  } catch (e) {
    ElMessage.error(`设置应用图标失败：${e}`);
  }
}

/** 恢复默认应用图标。 */
async function resetAppIcon() {
  try {
    await invoke("pet_reset_icon");
    ElMessage.success("已恢复默认图标");
  } catch (e) {
    ElMessage.error(`重置应用图标失败：${e}`);
  }
}

/** 任何字段变化都自动同步回全局 basicSettings 并持久化，然后广播事件通知其他窗口。 */
watch(
  () => [form.name, form.avatar, form.birthday, form.gender],
  () => {
    basicSettings.value.name = form.name.trim() || "多多";
    basicSettings.value.avatar = form.avatar;
    basicSettings.value.birthday = form.birthday;
    basicSettings.value.gender = form.gender;
    saveBasicSettings();
    // 广播事件，通知其他窗口（如主窗口）更新基础设置
    emitEvent(BASIC_SETTINGS_CHANGED_EVENT, basicSettings.value);
  },
  { deep: true },
);
</script>

<style scoped>
.basic-settings {
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
.basic-settings__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block__title {
  font-weight: 600;
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.avatar-uploader {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  flex: none;
}
.avatar-uploader :deep(.el-upload) {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--el-border-color);
  border-radius: 50%;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.avatar-uploader :deep(.el-upload:hover) {
  border-color: var(--el-color-primary);
}
.avatar-uploader__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
.avatar-uploader__icon {
  font-size: 20px;
  color: var(--el-text-color-secondary);
}
.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 输入框、日期选择器与性别选择统一宽度 */
:deep(.el-input),
:deep(.el-date-editor.el-input),
:deep(.el-radio-group) {
  width: 220px;
}

:deep(.el-radio-group) > label {
  flex: 1;
}

:deep(.el-radio-group) .el-radio-button__inner {
  width: 100%;
}

/* 裁剪区域 */
.cropper-wrap {
  width: 100%;
  height: 300px;
}
.cropper-wrap :deep(.vue-advanced-cropper) {
  width: 100%;
  height: 100%;
}
</style>
