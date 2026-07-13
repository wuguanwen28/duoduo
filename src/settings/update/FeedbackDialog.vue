<!--
  反馈弹窗：类型/正文/联系方式/图片（最多 3 张，单张压缩到 ≤2MB）。
  提交调用 Rust pet_submit_feedback，multipart 由后端组装。
-->
<template>
  <el-dialog
    v-model="visible"
    title="意见反馈"
    width="560px"
    :close-on-click-modal="false"
    append-to-body
    align-center
  >
    <el-form :model="form" label-width="110px" label-position="right">
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
          maxlength="2000"
          show-word-limit
          placeholder="说说你遇到的问题或想法…"
        />
      </el-form-item>

      <el-form-item label="图片">
        <div class="fb-img-col">
          <el-upload
            :file-list="fileList"
            list-type="picture-card"
            accept="image/*"
            multiple
            :auto-upload="false"
            :limit="3"
            :on-change="onChange"
            :on-remove="onRemove"
            :on-exceed="onExceed"
            :class="{ 'fb-upload--hide-trigger': fileList.length >= 3 }"
          >
            <el-icon class="fb-upload-icon"><Plus /></el-icon>
          </el-upload>
          <div class="fb-hint">最多 3 张，单张 ≤2MB，自动压缩</div>
          <div v-if="compressing" class="fb-hint">压缩中…</div>
        </div>
      </el-form-item>

      <el-form-item label="联系方式">
        <el-input
          v-model="form.contact"
          placeholder="QQ / 邮箱，方便我们回复（可选）"
        />
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
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { Plus } from '@element-plus/icons-vue'
import { compressImage } from './compressImage'
import type { UploadFile, UploadUserFile } from 'element-plus'

/** v-model 控制弹窗显隐 */
const visible = defineModel<boolean>({ default: false })

const form = ref({ type: 'feature', content: '', contact: '' })
/** el-upload 文件列表（驱动照片墙显示） */
const fileList = ref<UploadUserFile[]>([])
/** uid → 压缩后字节与 mime，提交时按 fileList 顺序取出 */
const compressed = new Map<number, { bytes: Uint8Array; mime: string }>()
/** uid → 预览 objectURL，卸载/删除时回收 */
const previewUrls = new Map<number, string>()

const compressing = ref(false)
const submitting = ref(false)

/** 重置表单 */
function reset() {
  form.value = { type: 'feature', content: '', contact: '' }
  for (const [, url] of previewUrls) URL.revokeObjectURL(url)
  previewUrls.clear()
  compressed.clear()
  fileList.value = []
}

/** 弹窗关闭时清理 */
watch(visible, (v) => {
  if (!v) reset()
})

/** 选图回调：压缩并把预览写回 file.url */
async function onChange(file: UploadFile) {
  if (!file.raw) return
  compressing.value = true
  try {
    const { bytes, mime } = await compressImage(file.raw)
    if (file.uid != null) {
      compressed.set(file.uid, { bytes, mime })
      const url = URL.createObjectURL(
        new Blob([bytes.buffer as ArrayBuffer], { type: mime }),
      )
      previewUrls.set(file.uid, url)
      file.url = url
    }
    // 确保该文件已在 fileList 中（el-upload 选择后会自动加入，这里幂等处理）
    if (!fileList.value.some((f) => f.uid === file.uid)) {
      fileList.value.push(file)
    }
  } catch (err) {
    // 压缩失败：从列表移除该文件
    fileList.value = fileList.value.filter((f) => f.uid !== file.uid)
    ElMessage.warning(`${file.name}：${err}`)
  } finally {
    compressing.value = false
  }
}

/** 删除某张：回收预览 URL 与压缩数据 */
function onRemove(file: UploadFile) {
  const url = previewUrls.get(file.uid)
  if (url) URL.revokeObjectURL(url)
  previewUrls.delete(file.uid)
  compressed.delete(file.uid)
  fileList.value = fileList.value.filter((f) => f.uid !== file.uid)
}

/** 超出上限提示 */
function onExceed() {
  ElMessage.warning('最多 3 张图片')
}

/** 提交 */
async function onSubmit() {
  if (!form.value.content.trim()) {
    ElMessage.warning('请填写正文')
    return
  }
  // 取出按当前顺序的压缩数据
  const items = fileList.value
    .map((f) => (f.uid != null ? compressed.get(f.uid) : undefined))
    .filter((v): v is { bytes: Uint8Array; mime: string } => !!v)
  submitting.value = true
  try {
    await invoke('pet_submit_feedback', {
      payload: {
        type: form.value.type,
        content: form.value.content,
        contact: form.value.contact || undefined,
        images: items.map((it) => Array.from(it.bytes)),
        mime: items.map((it) => it.mime),
      },
    })
    ElMessage.success('已提交，感谢反馈')
    visible.value = false
  } catch (e) {
    ElMessage.error(`提交失败：${e}`)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.fb-img-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.fb-upload-icon {
  font-size: 22px;
  color: var(--el-text-color-secondary);
}
/* 照片墙格子统一 100×100 */
.fb-img-col :deep(.el-upload-list--picture-card .el-upload-list__item),
.fb-img-col :deep(.el-upload--picture-card) {
  width: 100px;
  height: 100px;
}
/* 达到上限时隐藏「+」触发格子 */
.fb-upload--hide-trigger :deep(.el-upload--picture-card) {
  display: none;
}
.fb-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
