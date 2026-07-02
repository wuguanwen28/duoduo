<!--
  反馈弹窗：类型/正文/联系方式/图片（最多 3 张，单张压缩到 ≤2MB）。
  提交调用 Rust pet_submit_feedback，multipart 由后端组装。
-->
<template>
  <el-dialog
    v-model="visible"
    title="意见反馈"
    width="520px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form :model="form" label-position="top">
      <el-form-item label="类型">
        <el-select v-model="form.type" style="width: 100%">
          <el-option label="功能建议" value="feature" />
          <el-option label="Bug 报告" value="bug" />
          <el-option label="其他" value="other" />
        </el-select>
      </el-form-item>

      <el-form-item label="正文">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="5"
          maxlength="5000"
          show-word-limit
          placeholder="说说你遇到的问题或想法…"
        />
      </el-form-item>

      <el-form-item label="联系方式（可选）">
        <el-input v-model="form.contact" placeholder="QQ / 邮箱，方便我们回复" />
      </el-form-item>

      <el-form-item label="图片（最多 3 张，单张 ≤2MB）">
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="onPick"
        />
        <div class="fb-imgs">
          <div v-for="(img, i) in images" :key="i" class="fb-thumb-wrap">
            <img class="fb-thumb" :src="img.url" alt="预览" />
            <el-button
              class="fb-remove"
              type="danger"
              circle
              size="small"
              @click="removeImage(i)"
            >
              ×
            </el-button>
          </div>
          <el-button
            v-if="images.length < 3"
            class="fb-add"
            @click="fileInput?.click()"
          >
            + 添加图片
          </el-button>
        </div>
        <div v-if="compressing" class="fb-hint">压缩中…</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        提交
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { compressImage } from "./compressImage";

/** v-model 控制弹窗显隐 */
const visible = defineModel<boolean>({ default: false });

interface ImageItem {
  url: string; // 预览 objectURL
  bytes: Uint8Array;
  mime: string;
}

const form = ref({ type: "feature", content: "", contact: "" });
const images = ref<ImageItem[]>([]);
const compressing = ref(false);
const submitting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/** 重置表单 */
function reset() {
  form.value = { type: "feature", content: "", contact: "" };
  for (const img of images.value) URL.revokeObjectURL(img.url);
  images.value = [];
}

/** 弹窗关闭时清理 */
watch(visible, (v) => {
  if (!v) reset();
});

/** 选图 → 逐张压缩 */
async function onPick(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  target.value = ""; // 允许重复选同一文件
  const remain = 3 - images.value.length;
  for (const file of files.slice(0, remain)) {
    compressing.value = true;
    try {
      const { bytes, mime } = await compressImage(file);
      images.value.push({
        url: URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime })),
        bytes,
        mime,
      });
    } catch (err) {
      ElMessage.warning(`${file.name}：${err}`);
    } finally {
      compressing.value = false;
    }
  }
}

/** 删除某张 */
function removeImage(i: number) {
  URL.revokeObjectURL(images.value[i].url);
  images.value.splice(i, 1);
}

/** 提交 */
async function onSubmit() {
  if (!form.value.content.trim()) {
    ElMessage.warning("请填写正文");
    return;
  }
  submitting.value = true;
  try {
    await invoke("pet_submit_feedback", {
      payload: {
        type: form.value.type,
        content: form.value.content,
        contact: form.value.contact || undefined,
        images: images.value.map((img) => Array.from(img.bytes)),
        mime: images.value.map((img) => img.mime),
      },
    });
    ElMessage.success("已提交，感谢反馈");
    visible.value = false;
  } catch (e) {
    ElMessage.error(`提交失败：${e}`);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.fb-imgs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.fb-thumb-wrap {
  position: relative;
  width: 72px;
  height: 72px;
}
.fb-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
}
.fb-remove {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  padding: 0;
}
.fb-add {
  width: 72px;
  height: 72px;
  border: 1px dashed var(--el-border-color);
}
.fb-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
