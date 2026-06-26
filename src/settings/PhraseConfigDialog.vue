<template>
  <el-dialog
    v-model="visible"
    title="🗨️ 设置说话内容"
    width="460px"
    align-center
    :close-on-click-modal="false"
  >
    <div class="phrase-dialog__tips">
      每条文字对应被随机说出的概率，权重越高越容易被选中。
    </div>

    <div class="phrase-dialog__list">
      <div
        v-for="(item, index) in draft"
        :key="index"
        class="phrase-dialog__row"
      >
        <el-input
          v-model="item.text"
          class="phrase-dialog__input"
          placeholder="想说的话"
          maxlength="50"
          show-word-limit
        />
        <el-input-number
          v-model="item.weight"
          class="phrase-dialog__weight"
          :min="0"
          :max="100"
          :step="1"
          :controls="true"
          placeholder="权重"
        />
        <el-button
          class="phrase-dialog__delete"
          type="danger"
          text
          :icon="Delete"
          @click="remove(index)"
        />
      </div>
    </div>

    <el-button
      class="phrase-dialog__add"
      type="primary"
      text
      :icon="Plus"
      @click="add"
    >
      添加一条
    </el-button>

    <template #footer>
      <div class="phrase-dialog__footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="confirm">保存</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Delete, Plus } from "@element-plus/icons-vue";
import {
  speakPhrases,
  saveSpeakPhrases,
  type SpeakPhrase,
} from "../composables/useSpeakPhrases";

const visible = defineModel<boolean>("visible", { required: true });

/** 弹窗内部草稿，关闭时回滚。 */
const draft = ref<SpeakPhrase[]>([]);

function resetDraft() {
  draft.value = speakPhrases.value.map((p) => ({ ...p }));
}

function add() {
  draft.value.push({ text: "", weight: 5 });
}

function remove(index: number) {
  draft.value.splice(index, 1);
}

function confirm() {
  const valid = draft.value
    .map((p) => ({ text: p.text.trim(), weight: Math.max(0, Number(p.weight) || 0) }))
    .filter((p) => p.text !== "");
  saveSpeakPhrases(valid.length > 0 ? valid : [{ text: "喵~", weight: 1 }]);
  visible.value = false;
}

watch(visible, (val) => {
  if (val) resetDraft();
});
</script>

<style scoped>
.phrase-dialog__tips {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 14px;
}

.phrase-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phrase-dialog__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.phrase-dialog__input {
  flex: 1;
}

.phrase-dialog__weight {
  width: 100px;
}

.phrase-dialog__delete {
  flex: none;
}

.phrase-dialog__add {
  margin-top: 10px;
}

.phrase-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
