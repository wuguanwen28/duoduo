<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="560px"
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

    <el-button
      class="phrase-dialog__clear"
      type="danger"
      text
      :icon="Delete"
      @click="clear"
    >
      清空
    </el-button>

    <!-- 默认模板操作：仅非默认编辑态显示，避免无限套娃 -->
    <div v-if="!isDefault" class="phrase-dialog__default-bar">
      <el-button text :icon="DocumentCopy" @click="writeDefault">
        一键写入默认
      </el-button>
      <el-button text :icon="Edit" @click="defaultDialogVisible = true">
        编辑默认
      </el-button>
    </div>

    <template #footer>
      <div class="phrase-dialog__footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="confirm">保存</el-button>
      </div>
    </template>

    <!-- 编辑默认模板（套娃）：isDefault=true，confirm 调 saveDefaultSpeakPhrases -->
    <PhraseConfigDialog
      v-model:visible="defaultDialogVisible"
      v-model:phrases="defaultModel"
      :is-default="true"
      title="🗨️ 编辑默认说话内容"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { Delete, Plus, DocumentCopy, Edit } from "@element-plus/icons-vue";
import {
  defaultSpeakPhrases,
  saveDefaultSpeakPhrases,
  type SpeakPhrase,
} from "../../pet-core/speakPhrases";

const props = withDefaults(
  defineProps<{
    /** 是否为「编辑默认模板」态：true 时 confirm 写默认模板，且不显示默认操作栏。 */
    isDefault?: boolean;
    /** 弹窗标题。 */
    title?: string;
  }>(),
  { isDefault: false, title: "🗨️ 设置说话内容" },
);

const visible = defineModel<boolean>("visible", { required: true });
/** 当前编辑的短语池（双向绑定，父组件持有并落盘到对应入口）。 */
const phrasesModel = defineModel<SpeakPhrase[]>("phrases", { required: true });

/** 弹窗内部草稿，关闭时回滚。 */
const draft = ref<SpeakPhrase[]>([]);

/** 默认模板编辑弹窗显隐。 */
const defaultDialogVisible = ref(false);

/**
 * 默认模板的双向绑定：
 * - 读取：直接反映 defaultSpeakPhrases（全局 ref）。
 * - 写入（confirm）：由子弹窗 confirm 调 saveDefaultSpeakPhrases 落盘。
 * 这里用一个 computed 充当 v-model 中介，set 时走 saveDefaultSpeakPhrases。
 */
const defaultModel = computed<SpeakPhrase[]>({
  get: () => defaultSpeakPhrases.value,
  set: (v) => saveDefaultSpeakPhrases(v),
});

function resetDraft() {
  draft.value = (phrasesModel.value ?? []).map((p) => ({ ...p }));
}

function add() {
  draft.value.push({ text: "", weight: 5 });
}

function remove(index: number) {
  draft.value.splice(index, 1);
}

/** 清空当前草稿（仅清空编辑中的草稿，保存后才落盘）。 */
function clear() {
  draft.value = [];
}

/** 一键写入默认：把默认模板深拷贝进当前草稿（覆盖），保存后生效。 */
function writeDefault() {
  draft.value = defaultSpeakPhrases.value.map((p) => ({ ...p }));
}

function confirm() {
  const valid = draft.value
    .map((p) => ({ text: p.text.trim(), weight: Math.max(0, Number(p.weight) || 0) }))
    .filter((p) => p.text !== "");
  const result = valid.length > 0 ? valid : [{ text: "喵~", weight: 1 }];
  if (props.isDefault) {
    saveDefaultSpeakPhrases(result);
  } else {
    phrasesModel.value = result;
  }
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

.phrase-dialog__clear {
  margin-top: 10px;
  margin-left: 8px;
}

.phrase-dialog__default-bar {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.phrase-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
