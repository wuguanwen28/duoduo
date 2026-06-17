<template>
  <!-- 行为库：自治行为（待机/睡觉…），引用动作库里的动作；含默认行为互斥开关。 -->
  <el-card shadow="never" class="block">
    <template #header>
      <div class="block__head">
        <span class="block__title">😴 行为库</span>
        <el-button :icon="Plus" size="small" @click="addBehavior"
          >添加行为</el-button
        >
      </div>
    </template>
    <el-empty
      v-if="behaviors.length === 0"
      description="至少需要一个行为"
      :image-size="64"
    />
    <el-collapse v-else v-model="openBehaviors">
      <el-collapse-item v-for="(b, i) in behaviors" :key="i" :name="i">
        <template #title>
          <div class="item__title-row">
            <span class="item__name">{{ b.label || `行为${i + 1}` }}</span>
            <!-- 默认行为开关：开启此项时其他自动关闭（互斥单选）。 -->
            <span class="item__default" @click.stop>
              <span class="item__default-label">默认</span>
              <el-switch
                :model-value="defaultBehavior === b.key"
                :disabled="!b.key"
                size="small"
                @change="(v) => setDefaultBehavior(b, !!v)"
              />
            </span>
            <el-popconfirm
              title="确定删除该行为吗？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm="removeBehavior(i)"
            >
              <template #reference>
                <el-button
                  class="item__delete"
                  type="danger"
                  size="small"
                  plain
                  @click.stop
                >
                  <el-icon><Delete /></el-icon>
                  删除
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </template>
        <el-form label-width="92px" label-position="right">
          <el-form-item label="名称">
            <el-input
              v-model="b.label"
              placeholder="行为名称（如 待机、睡觉）"
            />
          </el-form-item>
          <el-form-item label="循环动作">
            <el-select v-model="b.base" placeholder="选一个动作" filterable>
              <el-option
                v-for="o in actionOptions"
                :key="o.key"
                :label="o.label"
                :value="o.key"
              />
            </el-select>
          </el-form-item>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="进入动作">
                <el-select
                  v-model="b.enter"
                  clearable
                  placeholder="（无）"
                  filterable
                >
                  <el-option
                    v-for="o in actionOptions"
                    :key="o.key"
                    :label="o.label"
                    :value="o.key"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="退出动作">
                <el-select
                  v-model="b.exit"
                  clearable
                  placeholder="（无）"
                  filterable
                >
                  <el-option
                    v-for="o in actionOptions"
                    :key="o.key"
                    :label="o.label"
                    :value="o.key"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="权重">
                <el-input-number
                  v-model="b.weight"
                  :min="0"
                  :style="{ width: '100%' }"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="被鼠标打断">
                <el-switch v-model="b.interruptible" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="持续时长">
            <div class="time-range">
              <el-input-number
                v-model="b.durationVal[0]"
                :min="0"
                controls-position="right"
              />
              <span class="dash">~</span>
              <el-input-number
                v-model="b.durationVal[1]"
                :min="0"
                controls-position="right"
              />
              <el-select v-model="b.durationUnit" class="unit-sel">
                <el-option
                  v-for="u in TIME_UNITS"
                  :key="u.value"
                  :label="u.label"
                  :value="u.value"
                />
              </el-select>
            </div>
          </el-form-item>
          <el-form-item label="插播间隔">
            <div class="time-range">
              <el-input-number
                v-model="b.delayVal[0]"
                :min="0"
                controls-position="right"
              />
              <span class="dash">~</span>
              <el-input-number
                v-model="b.delayVal[1]"
                :min="0"
                controls-position="right"
              />
              <el-select v-model="b.delayUnit" class="unit-sel">
                <el-option
                  v-for="u in TIME_UNITS"
                  :key="u.value"
                  :label="u.label"
                  :value="u.value"
                />
              </el-select>
            </div>
          </el-form-item>
          <el-form-item label="随机插播">
            <div class="random">
              <!-- 表头：仅第一行显示列标题 -->
              <div v-if="b.random.length > 0" class="random__header">
                <span class="random__col-action">动作</span>
                <span class="random__col-weight">权重</span>
                <span class="random__col-op"></span>
              </div>
              <div v-for="(r, j) in b.random" :key="j" class="random__row">
                <el-select
                  v-model="r.action"
                  placeholder="选择动作"
                  filterable
                  class="random__col-action"
                >
                  <el-option
                    v-for="o in actionOptions"
                    :key="o.key"
                    :label="o.label"
                    :value="o.key"
                  />
                </el-select>
                <el-input-number
                  v-model="r.weight"
                  :min="0"
                  controls-position="right"
                  class="random__col-weight"
                />
                <el-button
                  class="random__col-op"
                  type="danger"
                  plain
                  :icon="Delete"
                  @click="b.random.splice(j, 1)"
                />
              </div>
              <el-button
                :icon="Plus"
                size="small"
                @click="b.random.push({ action: '', weight: 1 })"
                >添加插播</el-button
              >
            </div>
          </el-form-item>
        </el-form>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Plus, Delete } from "@element-plus/icons-vue";
import type { ActionOption, BehaviorRow } from "./manifestTypes";

const props = defineProps<{
  /** 行为列表（就地增删改；父组件持有同一引用）。 */
  behaviors: BehaviorRow[];
  /** 动作下拉选项（来自父组件，由动作库派生）。 */
  actionOptions: ActionOption[];
}>();

/** 默认/兜底行为 key（与父组件双向绑定）。 */
const defaultBehavior = defineModel<string>("defaultBehavior", {
  required: true,
});

/** 时间单位选项（值＝换算成毫秒的因子）。 */
const TIME_UNITS = [
  { label: "秒", value: 1000 },
  { label: "分", value: 60000 },
  { label: "时", value: 3600000 },
];

/** 展开的折叠项（默认全展开）。 */
const openBehaviors = ref<number[]>([]);

// 列表被整体替换（加载 manifest）时，重置为全部展开；就地增删不在此重置。
watch(
  () => props.behaviors,
  () => {
    openBehaviors.value = props.behaviors.map((_, i) => i);
  },
  { immediate: true },
);

/**
 * 设置默认行为（行为标题里的「默认」开关）。开启某行为即把它设为默认，
 * 其他行为的开关因绑定 `defaultBehavior === b.key` 会自动关闭（互斥单选）；
 * 关闭操作被忽略——必须始终保留一个默认行为。
 */
function setDefaultBehavior(b: BehaviorRow, on: boolean) {
  if (on && b.key) defaultBehavior.value = b.key;
}

/**
 * 生成一个不与现有行为冲突的唯一 key（用户不可见，仅供引用使用）。
 * 形如 behavior1、behavior2…，自增直到不重复。
 */
function genBehaviorKey(): string {
  const used = new Set(props.behaviors.map((b) => b.key));
  let i = 1;
  let k = `behavior${i}`;
  while (used.has(k)) k = `behavior${++i}`;
  return k;
}

function addBehavior() {
  const key = genBehaviorKey();
  props.behaviors.push({
    key,
    label: "",
    base: "",
    enter: "",
    exit: "",
    weight: 1,
    interruptible: false,
    durationVal: [15, 40],
    durationUnit: 1000,
    delayVal: [3, 8],
    delayUnit: 1000,
    random: [],
  });
  openBehaviors.value.push(props.behaviors.length - 1);
  // 当前没有有效默认行为时（如这是第一个），把新行为设为默认，保证始终有默认。
  if (!props.behaviors.some((b) => b.key === defaultBehavior.value)) {
    defaultBehavior.value = key;
  }
}

function removeBehavior(i: number) {
  const removed = props.behaviors[i];
  props.behaviors.splice(i, 1);
  // 删掉的若是默认行为，自动把默认落到第一个剩余行为，保证始终有默认。
  if (removed && removed.key === defaultBehavior.value) {
    defaultBehavior.value = props.behaviors[0]?.key ?? "";
  }
}
</script>

<style>
.block__title {
  font-weight: 600;
}
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

:deep(.el-card__header) {
  padding: 10px 18px;
}
:deep(.el-card__body) {
  padding: 10px 18px;
}

/* collapse 标题栏灰色背景 */
:deep(.el-collapse-item__header) {
  --el-collapse-header-height: 40px;
  background: var(--el-fill-color-light);
  padding: 0 12px;
}
:deep(.el-collapse-item__wrap) {
  padding: 10px 12px;
}
:deep(.el-collapse-item__content) {
  padding-bottom: 0px;
}

.item__name {
  font-weight: 600;
  display: inline-block;
}
.item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

/* 「默认」开关靠右，删除按钮紧随其后 */
.item__default {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.item__default-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}
.item__delete {
  margin-right: 18px;
  margin-left: 10px;
}

.dash {
  margin: 0 8px;
  color: var(--el-text-color-secondary);
}
.time-range {
  display: flex;
  align-items: center;
}
.unit-sel {
  width: 80px;
  margin-left: 10px;
}

.random {
  width: 100%;
}
.random__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.random__col-action {
  width: 150px;
}
.random__col-weight {
  width: 150px;
}
.random__col-op {
  width: 32px;
}
.random__row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
</style>
