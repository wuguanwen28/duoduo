<template>
  <div class="resource-settings">
    <!-- 顶部工具条 + 提示一起固定在窗口顶部。 -->
    <div class="stickytop">
      <!-- 顶部工具条：标题 + 自动保存指示 + 操作。 -->
      <header class="topbar">
        <div class="topbar__left">
          <span class="topbar__title">资源设置</span>
          <transition name="saved-fade">
            <span v-if="savedShown" class="topbar__saved">
              <el-icon class="topbar__saved-icon"><CircleCheckFilled /></el-icon>
              已自动保存
            </span>
          </transition>
        </div>
        <div class="topbar__btns">
          <el-button :icon="Refresh" @click="reload">重新加载</el-button>
        </div>
      </header>
    </div>

    <main
      class="resource-settings__body"
      v-loading="loading"
      element-loading-text="读取中…"
    >
      <!-- 空状态：资源根下没有 manifest.json 时只显示引导，不渲染编辑区。 -->
      <el-empty
        v-if="!hasManifest"
        class="empty"
        :imageSize="100"
        description="未找到资源配置文件"
      >
        <div class="empty__tip">
          默认在程序同级的<code>resources/</code> 目录查找猫咪素材；<br />
          没找到就请选择一个文件夹作为资源目录。
        </div>
        <el-button type="primary" :icon="FolderOpened" @click="changeDir">
          选择资源目录
        </el-button>
      </el-empty>

      <template v-else>
        <!-- 资源目录：展示当前资源根 + 更换入口。 -->
        <el-card shadow="never" class="block">
          <div class="resdir">
            <el-input :model-value="root" readonly class="resdir__path">
              <template #prepend>当前目录</template>
              <template #append>
                <el-button :icon="FolderOpened" @click="changeDir">
                  更换目录
                </el-button>
              </template>
            </el-input>
          </div>
        </el-card>

        <!-- 跟随 follow -->
        <el-card shadow="never" class="block">
          <template #header
            ><span class="block__title">🎯 跟随光标</span></template
          >
          <el-form label-width="92px" label-position="left">
            <el-form-item label="帧目录">
              <DirSelect
                v-model="follow.dir"
                :tree="dirTree"
                placeholder="如 follow，或绝对路径"
                @refresh="loadDirTree"
              />
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

        <!-- 动作库（拆分组件） -->
        <ActionsCard
          :actions="actions"
          :dir-tree="dirTree"
          @refresh-dirs="loadDirTree"
        />

        <!-- 行为库（拆分组件） -->
        <BehaviorsCard
          :behaviors="behaviors"
          :action-options="actionOptions"
          v-model:default-behavior="defaultBehavior"
        />
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Refresh, FolderOpened, CircleCheckFilled } from "@element-plus/icons-vue";
import DirSelect, { type DirNode } from "./DirSelect.vue";
import ActionsCard from "./ActionsCard.vue";
import BehaviorsCard from "./BehaviorsCard.vue";
import type { ActionRow, BehaviorRow } from "./manifestTypes";

const root = ref("");
/** 资源根下是否已存在 manifest.json；为 false 时整页显示空状态。 */
const hasManifest = ref(false);
/** 资源根下的子目录树，供动作/跟随的目录树形下拉使用。 */
const dirTree = ref<DirNode[]>([]);
/** 读取 manifest 期间显示加载遮罩。 */
const loading = ref(false);

const follow = reactive({ dir: "follow", clockwise: true, startAngle: 0 });
const actions = ref<ActionRow[]>([]);
const behaviors = ref<BehaviorRow[]>([]);
/** 默认/兜底行为 key。 */
const defaultBehavior = ref("");

/** 所有动作的 {key,label}，供行为库下拉引用（值用 key，显示用名称；未命名用「动作N」序号）。 */
const actionOptions = computed(() =>
  actions.value
    .map((a, idx) => ({ key: a.key, label: a.name || `动作${idx + 1}` }))
    .filter((o) => o.key),
);

/** 由毫秒区间推断最合适的单位：能整除 min/max 两端的最大单位。 */
function inferUnit(a: number, b: number): number {
  for (const u of [3600000, 60000, 1000]) {
    if (a % u === 0 && b % u === 0) return u;
  }
  return 1000;
}

/** 拉取资源根下的子目录树（失败时置空，不阻塞）。 */
async function loadDirTree() {
  try {
    dirTree.value = await invoke<DirNode[]>("pet_list_dirs");
  } catch {
    dirTree.value = [];
  }
}

/**
 * 更换资源目录：弹系统目录选择器 → `pet_set_resource_root`（持久化到 AppData，
 * 缺 manifest.json 时自动创建空白模板）→ 重新加载本页 + 通知主窗热重载。
 */
async function changeDir() {
  let picked: string | null = null;
  try {
    const p = await open({ directory: true, multiple: false });
    if (typeof p === "string") picked = p;
  } catch (e) {
    ElMessage.error(`选择目录失败：${e}`);
    return;
  }
  if (!picked) return;
  try {
    await invoke("pet_set_resource_root", { path: picked });
    ElMessage.success("已切换资源目录");
    await reload();
    // 通知主窗用新资源根重新扫描并重挂宠物。
    await emitEvent("manifest-updated");
  } catch (e) {
    ElMessage.error(`切换目录失败：${e}`);
  }
}

/** 从 manifest 文本解析填充各编辑区。 */
function parseInto(content: string) {
  let m: any = {};
  if (content.trim()) {
    try {
      m = JSON.parse(content);
    } catch (e) {
      ElMessage.error(`manifest.json 解析失败，已按空白处理：${e}`);
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
            // __speak 的独立短语池原样带出。
            phrases:
              Array.isArray(r?.phrases) && r?.action === "__speak"
                ? r.phrases
                    .filter((p: any) => p && typeof p.text === "string")
                    .map((p: any) => ({
                      text: String(p.text).trim(),
                      weight: Math.max(0, Number(p.weight) || 0),
                    }))
                : undefined,
          }))
        : [],
    };
  });

  // 默认行为：取 manifest.defaultBehavior，无效则回退到第一个行为。
  const dft = typeof m.defaultBehavior === "string" ? m.defaultBehavior : "";
  defaultBehavior.value = behaviors.value.some((b) => b.key === dft)
    ? dft
    : (behaviors.value[0]?.key ?? "");
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
        .map((r) => {
          const o: any = { action: r.action, weight: r.weight };
          // __speak 才写 phrases（非空数组时）。
          if (r.action === "__speak" && Array.isArray(r.phrases) && r.phrases.length > 0) {
            o.phrases = r.phrases.map((p) => ({
              text: p.text.trim(),
              weight: Math.max(0, Number(p.weight) || 0),
            }));
          }
          return o;
        }),
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
  // 加载期间抑制自动保存：parseInto 写入响应式状态会触发监听，不应回存。
  suppressSave = true;
  loading.value = true;
  try {
    const r = await invoke<{ root: string; content: string; exists: boolean }>(
      "pet_read_manifest",
    );
    root.value = r.root;
    hasManifest.value = r.exists;
    parseInto(r.content);
    await loadDirTree();
    if (r.exists) {
      ElMessage.success("已加载 manifest.json");
    } else {
      // 不再静默载入模板，而是由上层的空状态引导用户选择资源目录。
      ElMessage.warning("未找到 manifest.json，请选择资源目录");
    }
  } catch (e) {
    ElMessage.error(`读取失败：${e}`);
  } finally {
    loading.value = false;
    // 等本次状态变更引发的监听跑完，再恢复自动保存，避免"加载即保存"。
    await nextTick();
    suppressSave = false;
  }
}

/** 自动保存的防抖计时器与抑制标志（加载期间不回存）。 */
let saveTimer: number | undefined;
let suppressSave = false;
/** 「已自动保存」提示的显示状态与其 3 秒自动消失计时器。 */
const savedShown = ref(false);
let savedTimer: number | undefined;

/** 弹出「已自动保存」指示，3 秒后自动淡出。 */
function flashSaved() {
  savedShown.value = true;
  if (savedTimer !== undefined) window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => (savedShown.value = false), 3000);
}

/** 静默写回 manifest 并通知主窗热重载（成功只闪一个「已自动保存」指示）。 */
async function save() {
  try {
    const json = JSON.stringify(build(), null, 2);
    await invoke("pet_write_manifest", { content: json });
    // 广播事件，主窗收到后热重载资源并重挂宠物，改动即时生效。
    await emitEvent("manifest-updated");
    flashSaved();
  } catch (e) {
    // 失败仍提示，避免静默丢改动。
    ElMessage.error(`保存失败：${e}`);
  }
}

// 编辑即自动保存：监听各编辑区（含子组件就地改动），防抖 600ms 后静默写回。
watch(
  [follow, actions, behaviors, defaultBehavior],
  () => {
    if (suppressSave || !hasManifest.value) return;
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 600);
  },
  { deep: true },
);

onMounted(reload);
</script>

<style scoped>
.resource-settings {
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
  height: 54px;
  box-sizing: border-box;
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
.topbar__saved {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-color-success);
}
.topbar__saved-icon {
  font-size: 14px;
}
/* 「已自动保存」淡入淡出 */
.saved-fade-enter-active,
.saved-fade-leave-active {
  transition: opacity 0.3s ease;
}
.saved-fade-enter-from,
.saved-fade-leave-to {
  opacity: 0;
}
.topbar__btns {
  flex: none;
  display: flex;
  gap: 8px;
}

.resource-settings__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty {
  margin: auto;
  padding: 40px 16px;
}
.empty__tip {
  max-width: 420px;
  margin: 0 auto 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.empty__tip code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: "Consolas", "Microsoft YaHei", monospace;
}

.resdir {
  display: flex;
  gap: 8px;
  align-items: center;
}
.resdir__path {
  flex: 1;
  min-width: 0;
}

:deep(.el-card__header) {
  padding: 10px 18px;
}
:deep(.el-card__body) {
  padding: 10px 18px;
}

.block__title {
  font-weight: 600;
}

.hint {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
