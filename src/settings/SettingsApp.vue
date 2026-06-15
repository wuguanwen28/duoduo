<template>
  <div class="settings">
    <!-- 顶部工具条 + 提示一起固定在窗口顶部。 -->
    <div class="stickytop">
      <!-- 顶部工具条：标题 + 路径 + 操作。 -->
      <header class="topbar">
        <div class="topbar__left">
          <span class="topbar__title">资源设置</span>
          <el-tag
            v-if="root"
            type="info"
            size="small"
            effect="plain"
            class="topbar__path"
          >
            {{ root }}
          </el-tag>
        </div>
        <div class="topbar__btns">
          <el-button :icon="Refresh" @click="reload">重新加载</el-button>
          <el-button type="primary" :icon="Check" @click="save">保存</el-button>
        </div>
      </header>

      <el-alert
        v-if="tip"
        :title="tip"
        :type="tipKind"
        :closable="false"
        show-icon
        class="settings__alert"
      />
    </div>

    <main
      class="settings__body"
      v-loading="loading"
      element-loading-text="读取中…"
    >
      <!-- 跟随 follow -->
      <el-card shadow="never" class="block">
        <template #header
          ><span class="block__title">🎯 跟随光标</span></template
        >
        <el-form label-width="92px" label-position="left">
          <el-form-item label="帧目录">
            <el-input v-model="follow.dir" placeholder="如 follow，或绝对路径">
              <template #append>
                <el-button
                  :icon="FolderOpened"
                  @click="pickDir((d) => (follow.dir = d))"
                  >选目录</el-button
                >
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="起始角度">
            <el-input-number
              v-model="follow.startAngle"
              :min="0"
              :max="359"
              controls-position="right"
            />
            <span class="hint">第 0 帧朝向：0=上 90=右 180=下 270=左</span>
          </el-form-item>
          <el-form-item label="顺时针">
            <el-switch v-model="follow.clockwise" />
            <span class="hint">帧号递增方向（关 = 逆时针）</span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 行为 behaviors（放在动作库上面） -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="block__head">
            <span class="block__title">🧠 行为库</span>
            <el-button :icon="Plus" size="small" @click="addBehavior"
              >添加行为</el-button
            >
          </div>
        </template>
        <el-form label-width="92px" label-position="left" class="default-beh">
          <el-form-item label="默认行为">
            <el-select
              v-model="defaultBehavior"
              placeholder="启动 / 兜底时进入的行为"
              filterable
            >
              <el-option
                v-for="o in behaviorOptions"
                :key="o.key"
                :label="o.label"
                :value="o.key"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <el-empty
          v-if="behaviors.length === 0"
          description="至少需要一个行为"
          :image-size="64"
        />
        <el-collapse v-else v-model="openBehaviors">
          <el-collapse-item v-for="(b, i) in behaviors" :key="i" :name="i">
            <template #title>
              <span class="item__name">{{
                b.label || b.key || "未命名行为"
              }}</span>
            </template>
            <el-form label-width="92px" label-position="right">
              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="标识">
                    <el-input
                      v-model="b.key"
                      placeholder="key（引用需要，唯一）"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="名称">
                    <el-input v-model="b.label" placeholder="可中文，可空" />
                  </el-form-item>
                </el-col>
              </el-row>

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
                  <el-form-item label="权重">
                    <el-input-number
                      v-model="b.weight"
                      :min="0"
                      size="small"
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
                    size="small"
                    controls-position="right"
                  />
                  <span class="dash">~</span>
                  <el-input-number
                    v-model="b.durationVal[1]"
                    :min="0"
                    size="small"
                    controls-position="right"
                  />
                  <el-select
                    v-model="b.durationUnit"
                    size="small"
                    class="unit-sel"
                  >
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
                    size="small"
                    controls-position="right"
                  />
                  <span class="dash">~</span>
                  <el-input-number
                    v-model="b.delayVal[1]"
                    :min="0"
                    size="small"
                    controls-position="right"
                  />
                  <el-select
                    v-model="b.delayUnit"
                    size="small"
                    class="unit-sel"
                  >
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
                  <div v-for="(r, j) in b.random" :key="j" class="random__row">
                    <el-select
                      v-model="r.action"
                      placeholder="动作"
                      filterable
                      class="sel-sm"
                    >
                      <el-option
                        v-for="o in actionOptions"
                        :key="o.key"
                        :label="o.label"
                        :value="o.key"
                      />
                    </el-select>
                    <span class="opt">
                      权重
                      <el-input-number
                        v-model="r.weight"
                        :min="0"
                        size="default"
                        controls-position="right"
                      />
                    </span>
                    <el-button
                      type="danger"
                      :icon="Delete"
                      plain
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
              <el-form-item label=" ">
                <el-button
                  type="danger"
                  :icon="Delete"
                  plain
                  @click="removeBehavior(i)"
                  >删除行为</el-button
                >
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <!-- 动作 actions -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="block__head">
            <span class="block__title">🎬 动作库</span>
            <el-button :icon="Plus" size="small" @click="addAction"
              >添加动作</el-button
            >
          </div>
        </template>
        <el-empty
          v-if="actions.length === 0"
          description="还没有动作"
          :image-size="64"
        />
        <el-collapse v-else v-model="openActions">
          <el-collapse-item v-for="(a, i) in actions" :key="i" :name="i">
            <template #title>
              <span class="item__name">{{
                a.name || a.key || "未命名动作"
              }}</span>
            </template>
            <el-form label-width="92px" label-position="left">
              <el-form-item label="标识名称">
                <div class="two-col">
                  <el-input
                    v-model="a.key"
                    placeholder="key（引用需要，唯一）"
                  />
                  <el-input
                    v-model="a.name"
                    placeholder="名称（可中文，可空）"
                  />
                </div>
              </el-form-item>
              <el-form-item label="图片目录">
                <el-input v-model="a.dir" placeholder="相对资源根或绝对路径">
                  <template #append>
                    <el-button
                      :icon="FolderOpened"
                      @click="pickDir((d) => (a.dir = d))"
                      >选目录</el-button
                    >
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item label="播放选项">
                <el-row class="cells">
                  <el-col :span="8"
                    ><div class="cell">
                      <span class="cell__label">帧率fps</span
                      ><el-input-number
                        v-model="a.fps"
                        :min="1"
                        :max="120"
                        size="small"
                        controls-position="right"
                      /></div
                  ></el-col>
                  <el-col :span="8"
                    ><div class="cell">
                      <span class="cell__label">来回播放</span
                      ><el-switch v-model="a.yoyo" /></div
                  ></el-col>
                  <el-col :span="8"
                    ><div class="cell">
                      <span class="cell__label">倒放</span
                      ><el-switch v-model="a.reverse" /></div
                  ></el-col>
                </el-row>
              </el-form-item>
              <el-form-item label="视觉微调">
                <el-row class="cells">
                  <el-col :span="8"
                    ><div class="cell">
                      <span class="cell__label">X轴偏移</span
                      ><el-input-number
                        v-model="a.offsetX"
                        :step="0.01"
                        :precision="3"
                        size="small"
                        controls-position="right"
                      /></div
                  ></el-col>
                  <el-col :span="8"
                    ><div class="cell">
                      <span class="cell__label">Y轴偏移</span
                      ><el-input-number
                        v-model="a.offsetY"
                        :step="0.01"
                        :precision="3"
                        size="small"
                        controls-position="right"
                      /></div
                  ></el-col>
                  <el-col :span="8"
                    ><div class="cell">
                      <span class="cell__label">缩放</span
                      ><el-input-number
                        v-model="a.scale"
                        :step="0.05"
                        :precision="2"
                        :min="0.1"
                        size="small"
                        controls-position="right"
                      /></div
                  ></el-col>
                </el-row>
              </el-form-item>
              <el-form-item label=" ">
                <el-button :icon="VideoPlay" @click="testPlay(a.key)"
                  >测试播放</el-button
                >
                <el-button
                  type="danger"
                  :icon="Delete"
                  plain
                  @click="removeAction(i)"
                  >删除动作</el-button
                >
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Refresh,
  Check,
  Plus,
  Delete,
  FolderOpened,
  VideoPlay,
} from "@element-plus/icons-vue";

/** 动作编辑行。 */
interface ActionRow {
  /** 标识：引用需要（base/enter/exit/random 都引用它），唯一。 */
  key: string;
  /** 显示名（可中文），仅界面展示，可空。 */
  name: string;
  dir: string;
  fps: number;
  yoyo: boolean;
  reverse: boolean;
  offsetX: number;
  offsetY: number;
  scale: number;
}
/** 随机插播编辑行。 */
interface RandomRow {
  action: string;
  weight: number;
}
/** 行为编辑行。 */
interface BehaviorRow {
  /** 标识：行为 key（defaultBehavior/enter/exit/菜单触发都引用它），唯一。 */
  key: string;
  /** 显示名（可中文），仅界面展示，可空。 */
  label: string;
  base: string;
  enter: string;
  exit: string;
  weight: number;
  interruptible: boolean;
  /** 持续时长 [min,max]（按 durationUnit 的显示值）。 */
  durationVal: [number, number];
  /** 持续时长单位（毫秒因子：1000=秒 / 60000=分 / 3600000=时）。 */
  durationUnit: number;
  /** 插播间隔 [min,max]（按 delayUnit 的显示值）。 */
  delayVal: [number, number];
  /** 插播间隔单位（毫秒因子）。 */
  delayUnit: number;
  random: RandomRow[];
}

const root = ref("");
/** 读取 manifest 期间显示加载遮罩。 */
const loading = ref(false);
const tip = ref("");
const tipKind = ref<"success" | "error">("success");

const follow = reactive({ dir: "follow", clockwise: true, startAngle: 0 });
const actions = ref<ActionRow[]>([]);
const behaviors = ref<BehaviorRow[]>([]);
// 展开的折叠项（默认全展开）。
const openActions = ref<number[]>([]);
const openBehaviors = ref<number[]>([]);

/** 所有动作的 {key,label}，供 base/enter/exit/random 下拉引用（值用 key，显示用名称）。 */
const actionOptions = computed(() =>
  actions.value
    .filter((a) => a.key)
    .map((a) => ({
      key: a.key,
      label: a.name ? `${a.name}（${a.key}）` : a.key,
    })),
);

/** 默认/兜底行为 key。 */
const defaultBehavior = ref("");

/** 所有行为的 {key,label}，供默认行为下拉引用（值用 key，显示用名称）。 */
const behaviorOptions = computed(() =>
  behaviors.value
    .filter((b) => b.key)
    .map((b) => ({
      key: b.key,
      label: b.label ? `${b.label}（${b.key}）` : b.key,
    })),
);

/** 时间单位选项（值＝换算成毫秒的因子）。 */
const TIME_UNITS = [
  { label: "秒", value: 1000 },
  { label: "分", value: 60000 },
  { label: "时", value: 3600000 },
];

/** 由毫秒区间推断最合适的单位：能整除 min/max 两端的最大单位。 */
function inferUnit(a: number, b: number): number {
  for (const u of [3600000, 60000, 1000]) {
    if (a % u === 0 && b % u === 0) return u;
  }
  return 1000;
}

function showTip(msg: string, kind: "success" | "error" = "success") {
  tip.value = msg;
  tipKind.value = kind;
}

/** 弹系统目录选择器，选中后回调（用户取消则忽略）。 */
async function pickDir(set: (dir: string) => void) {
  try {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") set(picked);
  } catch (e) {
    showTip(`选择目录失败：${e}`, "error");
  }
}

/** 测试播放：广播 pet-play-action，由主窗状态机接住播放。 */
async function testPlay(name: string) {
  if (!name) return;
  try {
    await emitEvent("pet-play-action", name);
    showTip(`已通知主窗播放「${name}」`);
  } catch (e) {
    showTip(`测试播放失败：${e}`, "error");
  }
}

function addAction() {
  // 新动作插到第一位；已展开项下标整体后移，并默认展开新项。
  actions.value.unshift({
    key: "",
    name: "",
    dir: "",
    fps: 24,
    yoyo: false,
    reverse: false,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  openActions.value = [0, ...openActions.value.map((i) => i + 1)];
}
function removeAction(i: number) {
  actions.value.splice(i, 1);
}
function addBehavior() {
  behaviors.value.push({
    key: "",
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
  openBehaviors.value.push(behaviors.value.length - 1);
}
function removeBehavior(i: number) {
  behaviors.value.splice(i, 1);
}

/** 从 manifest 文本解析填充各编辑区。 */
function parseInto(content: string) {
  let m: any = {};
  if (content.trim()) {
    try {
      m = JSON.parse(content);
    } catch (e) {
      showTip(`manifest.json 解析失败，已按空白处理：${e}`, "error");
      m = {};
    }
  }
  const f = m.follow ?? {};
  follow.dir = f.dir ?? "follow";
  follow.clockwise = f.clockwise !== false;
  follow.startAngle = typeof f.startAngle === "number" ? f.startAngle : 0;

  actions.value = Object.entries<any>(m.actions ?? {}).map(([key, d]) => ({
    key,
    name: d?.name ?? "",
    dir: d?.dir ?? "",
    fps: typeof d?.fps === "number" ? d.fps : 24,
    yoyo: !!d?.yoyo,
    reverse: !!d?.reverse,
    offsetX: typeof d?.offsetX === "number" ? d.offsetX : 0,
    offsetY: typeof d?.offsetY === "number" ? d.offsetY : 0,
    scale: typeof d?.scale === "number" ? d.scale : 1,
  }));

  behaviors.value = Object.entries<any>(m.behaviors ?? {}).map(([name, b]) => {
    const durMs: [number, number] = Array.isArray(b?.duration)
      ? [b.duration[0], b.duration[1]]
      : [15000, 40000];
    const dlyMs: [number, number] = Array.isArray(b?.delay)
      ? [b.delay[0], b.delay[1]]
      : [3000, 8000];
    const du = inferUnit(durMs[0], durMs[1]);
    const ld = inferUnit(dlyMs[0], dlyMs[1]);
    return {
      key: name,
      label: typeof b?.name === "string" ? b.name : "",
      base: b?.base ?? "",
      enter: b?.enter ?? "",
      exit: b?.exit ?? "",
      weight: typeof b?.weight === "number" ? b.weight : 1,
      interruptible: !!b?.interruptible,
      durationVal: [durMs[0] / du, durMs[1] / du] as [number, number],
      durationUnit: du,
      delayVal: [dlyMs[0] / ld, dlyMs[1] / ld] as [number, number],
      delayUnit: ld,
      random: Array.isArray(b?.random)
        ? b.random.map((r: any) => ({
            action: r?.action ?? "",
            weight: typeof r?.weight === "number" ? r.weight : 1,
          }))
        : [],
    };
  });

  // 默认行为：取 manifest.defaultBehavior，无效则回退到第一个行为。
  const dft = typeof m.defaultBehavior === "string" ? m.defaultBehavior : "";
  defaultBehavior.value = behaviors.value.some((b) => b.key === dft)
    ? dft
    : (behaviors.value[0]?.key ?? "");

  // 默认全部展开。
  openActions.value = actions.value.map((_, i) => i);
  openBehaviors.value = behaviors.value.map((_, i) => i);
}

/** 把各编辑区组装回 manifest 对象（省略默认值，保持简洁）。 */
function build(): any {
  const acts: Record<string, any> = {};
  for (const a of actions.value) {
    if (!a.key) continue;
    const o: any = { dir: a.dir, fps: a.fps };
    if (a.name) o.name = a.name;
    if (a.yoyo) o.yoyo = true;
    if (a.reverse) o.reverse = true;
    if (a.offsetX !== 0) o.offsetX = a.offsetX;
    if (a.offsetY !== 0) o.offsetY = a.offsetY;
    if (a.scale !== 1) o.scale = a.scale;
    acts[a.key] = o;
  }
  const behs: Record<string, any> = {};
  for (const b of behaviors.value) {
    if (!b.key) continue;
    const o: any = {
      weight: b.weight,
      duration: [
        b.durationVal[0] * b.durationUnit,
        b.durationVal[1] * b.durationUnit,
      ],
      base: b.base,
      random: b.random
        .filter((r) => r.action)
        .map((r) => ({ action: r.action, weight: r.weight })),
      delay: [b.delayVal[0] * b.delayUnit, b.delayVal[1] * b.delayUnit],
    };
    if (b.label) o.name = b.label;
    if (b.interruptible) o.interruptible = true;
    if (b.enter) o.enter = b.enter;
    if (b.exit) o.exit = b.exit;
    behs[b.key] = o;
  }
  return {
    version: 1,
    defaultBehavior: defaultBehavior.value,
    follow: {
      dir: follow.dir,
      clockwise: follow.clockwise,
      startAngle: follow.startAngle,
    },
    actions: acts,
    behaviors: behs,
  };
}

async function reload() {
  loading.value = true;
  try {
    const r = await invoke<{ root: string; content: string; exists: boolean }>(
      "pet_read_manifest",
    );
    root.value = r.root;
    parseInto(r.content);
    showTip(
      r.exists
        ? "已加载 manifest.json"
        : "未找到 manifest.json，已载入空白模板，保存后会自动创建",
    );
  } catch (e) {
    showTip(`读取失败：${e}`, "error");
  } finally {
    loading.value = false;
  }
}

async function save() {
  try {
    const json = JSON.stringify(build(), null, 2);
    await invoke("pet_write_manifest", { content: json });
    // 广播事件，主窗收到后热重载资源并重挂宠物，改动即时生效。
    await emitEvent("manifest-updated");
    showTip("已保存 ✓ 主窗已自动热重载");
  } catch (e) {
    showTip(`保存失败：${e}`, "error");
  }
}

onMounted(reload);
</script>

<style scoped>
.settings {
  min-height: 100vh;
}

.stickytop {
  position: sticky;
  top: 0;
  z-index: 10;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-light);
}
.topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}
.topbar__title {
  font-size: 16px;
  font-weight: 600;
}
.topbar__path {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar__btns {
  flex: none;
  display: flex;
  gap: 8px;
}

.settings__alert {
  border-radius: 0;
}

.settings__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block__title {
  font-weight: 600;
}
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.two-col {
  display: flex;
  width: 100%;
}
.two-col .el-input {
  flex: 1;
}
/* 像 input-group：两个输入框紧贴，中缝合并、不留间隙、不出现双线 */
.two-col .el-input:first-child :deep(.el-input__wrapper) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.two-col .el-input:last-child :deep(.el-input__wrapper) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  margin-left: -1px;
}

.hint {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 14px;
}
/* 行内数字框收窄，避免「视觉微调」三个挤到换行 */
.opt :deep(.el-input-number) {
  width: 96px;
}

/* 栅格单元：小 label 固定宽度左对齐 + 控件填满列剩余 */
.cells {
  width: 100%;
}
.cell {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 12px;
}
.cell__label {
  flex: none;
  text-align: right;
  width: 60px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.cell :deep(.el-input-number) {
  flex: 1;
  min-width: 0;
}
.sel-sm {
  width: 150px;
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

/* collapse 标题栏灰色背景 */
:deep(.el-collapse-item__header) {
  --el-collapse-header-height: 40px;
  background: var(--el-fill-color-light);
  padding: 0 12px;
}
:deep(.el-collapse-item__wrap) {
  padding: 6px 12px;
}

.item__name {
  font-weight: 600;
  display: inline-block;
}

.random {
  width: 100%;
}
.random__row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
</style>
