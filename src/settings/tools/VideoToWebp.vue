<template>
  <div class="v2w">
    <header class="v2w__top">
      <span>
        <span class="v2w__title">🎞️ 视频转帧</span>
        <span class="v2w__hint">绿幕/纯色背景视频 → 背景透明的连续图片</span>
      </span>
      <el-button
        plain
        type="primary"
        :icon="QuestionFilled"
        @click="helpVisible = true"
        >使用说明</el-button
      >
    </header>

    <main class="v2w__body">
      <el-card shadow="never" class="block">
        <!-- 选视频 -->
        <el-form label-width="92px" label-position="left">
          <el-form-item label="源视频">
            <el-input
              :model-value="videoPath"
              readonly
              placeholder="选择一个视频（mp4/mov/webm…）"
            >
              <template #append>
                <el-button
                  :icon="VideoCamera"
                  :loading="decoding"
                  @click="pickVideo"
                  >选视频</el-button
                >
              </template>
            </el-input>
          </el-form-item>
          <el-form-item v-if="decoding" label="解码进度">
            <el-progress
              class="grow"
              :percentage="decodePercent"
              :indeterminate="decodePercent === 0"
            />
          </el-form-item>
        </el-form>

        <!-- 左右预览：左=原始帧（瞬时，拖区域框），右=抠图结果（防抖，可缩放平移） -->
        <div v-if="ready" class="preview">
          <div class="preview__pair">
            <div class="preview__col">
              <div class="preview__label">原始（拖蓝框调区域）</div>
              <div
                ref="stageEl"
                class="preview__stage"
                :class="{ 'is-picking': picking }"
                :style="{ width: dispW + 'px' }"
                @mousemove="onCanvasMove"
                @mouseleave="onCanvasLeave"
              >
                <canvas
                  ref="origCanvas"
                  class="preview__canvas"
                  @click="onCanvasClick"
                />
                <canvas
                  v-show="picking"
                  ref="pickPreview"
                  class="preview__pick-preview"
                  :style="{
                    left: pickPreviewPos.x + 'px',
                    top: pickPreviewPos.y + 'px',
                  }"
                />
                <template v-for="(r, i) in records" :key="i">
                  <div
                    v-if="r.scoped"
                    class="wm"
                    :class="{ 'wm--active': activeAt(r, frameIndex) }"
                    :style="boxStyle(r)"
                    @mousedown.stop="startDrag($event, r, 'move')"
                  >
                    <span class="wm__tag">{{ i + 1 }}</span>
                    <span
                      class="wm__handle"
                      @mousedown.stop="startDrag($event, r, 'resize')"
                    />
                  </div>
                </template>
              </div>
            </div>
            <div class="preview__col">
              <div class="preview__label">
                <span>抠图结果（滚轮缩放，拖动平移）</span>
                <el-tooltip content="重置缩放与位置" placement="top">
                  <el-button
                    class="preview__reset"
                    text
                    size="small"
                    :icon="Refresh"
                    @click="resetResultView"
                  />
                </el-tooltip>
              </div>
              <div
                class="preview__stage preview__stage--checker"
                :style="{ width: dispW + 'px', height: dispH + 'px' }"
                @wheel.prevent="onResultWheel"
                @mousedown="onResultDragStart"
              >
                <canvas
                  ref="resultCanvas"
                  class="preview__canvas"
                  :style="resultCanvasStyle"
                />
              </div>
            </div>
          </div>

          <div class="timeline">
            <el-slider
              v-model="frameIndex"
              :min="0"
              :max="Math.max(0, totalFrames - 1)"
              :step="1"
              :format-tooltip="(v: number) => `第 ${v + 1} 帧`"
              @input="onScrub"
            />
            <span class="timeline__t"
              >帧 {{ frameIndex + 1 }} / {{ totalFrames }} ·
              {{ fmtTime(curTime) }}</span
            >
          </div>
        </div>

        <!-- 抠图设置：一个区域列表（第一条默认全局） -->
        <div v-if="ready" class="recs">
          <div class="recs__title">
            <span>抠图设置</span>
          </div>
          <div v-for="(r, i) in records" :key="i" class="rec">
            <div class="rec__head">
              <span class="rec__name">{{
                r.scoped ? `区域抠图 ${i + 1}` : `全局抠图${i + 1}`
              }}</span>
              <span v-if="r.scoped" class="rec__sum"
                >帧 {{ r.start }}~{{ r.end }}</span
              >
              <el-button
                v-if="records.length > 1"
                class="rec__del"
                type="danger"
                text
                size="small"
                :icon="Close"
                @click="removeRecord(i)"
              />
            </div>

            <!-- 颜色 + 容差：左右两栏。 -->
            <el-row :gutter="12" class="rec__pair">
              <el-col :span="12">
                <!-- 颜色行：单个色块 + 按钮组（吸管 / 自动识别） -->
                <div class="rec__colors">
                  <span class="rec__lbl">颜色</span>
                  <el-button-group>
                    <el-button class="rec__colorbtn">
                      <el-color-picker
                        class="rec__colorpicker"
                        v-model="r.color"
                        @change="scheduleResult"
                      />
                    </el-button>
                    <el-button
                      :type="
                        picking && pickTarget === i ? 'primary' : 'default'
                      "
                      :icon="Pointer"
                      @click="pickInto(i)"
                    >
                      {{ picking && pickTarget === i ? "取色中…" : "吸管取色" }}
                    </el-button>
                    <el-button :icon="MagicStick" @click="autoDetect(i)"
                      >自动识别</el-button
                    >
                  </el-button-group>
                </div>
              </el-col>
              <el-col :span="12">
                <!-- 容差 -->
                <div class="rec__row">
                  <span class="rec__lbl">容差</span>
                  <el-slider
                    v-model="r.tolerance"
                    :min="1"
                    :max="100"
                    class="grow"
                    @input="scheduleResult"
                  />
                </div>
              </el-col>
            </el-row>

            <!-- 高级设置：区域 / 时间（仅本条生效）；折叠面板的开合直接驱动 r.scoped。 -->
            <el-collapse
              class="rec__adv-collapse"
              :model-value="r.scoped ? ['adv'] : []"
              @update:model-value="
                (v) => setScoped(i, (v as string[]).includes('adv'))
              "
            >
              <el-collapse-item name="adv" title="高级设置">
                <div class="rec__row">
                  <span class="rec__lbl">区域(%)</span>
                  <el-input-number
                    v-model="r.x"
                    :min="0"
                    :max="100"
                    controls-position="right"
                    @change="scheduleResult"
                  >
                    <template #prefix>X</template>
                  </el-input-number>
                  <el-input-number
                    v-model="r.y"
                    :min="0"
                    :max="100"
                    controls-position="right"
                    @change="scheduleResult"
                  >
                    <template #prefix>Y</template>
                  </el-input-number>
                  <el-input-number
                    v-model="r.w"
                    :min="1"
                    :max="100"
                    controls-position="right"
                    @change="scheduleResult"
                  >
                    <template #prefix>W</template>
                  </el-input-number>
                  <el-input-number
                    v-model="r.h"
                    :min="1"
                    :max="100"
                    controls-position="right"
                    @change="scheduleResult"
                  >
                    <template #prefix>H</template>
                  </el-input-number>
                </div>
                <div class="rec__row">
                  <span class="rec__lbl">帧段</span>
                  <el-input-number
                    v-model="r.start"
                    :min="0"
                    :max="Math.max(0, totalFrames - 1)"
                    :step="1"
                    :precision="0"
                    controls-position="right"
                    @change="scheduleResult"
                  >
                    <template #prefix>
                      <span style="margin-right: 8px">起</span>
                    </template>
                    <template #suffix>
                      <el-button
                        text
                        size="small"
                        style="padding: 0 4px"
                        @click="((r.start = frameIndex), scheduleResult())"
                      >
                        设为当前帧
                      </el-button>
                    </template>
                  </el-input-number>

                  <el-input-number
                    v-model="r.end"
                    :min="0"
                    :max="Math.max(0, totalFrames - 1)"
                    :step="1"
                    :precision="0"
                    controls-position="right"
                    @change="scheduleResult"
                  >
                    <template #prefix>
                      <span style="margin-right: 8px">止</span>
                    </template>
                    <template #suffix>
                      <el-button
                        text
                        size="small"
                        style="padding: 0 4px"
                        @click="((r.end = frameIndex), scheduleResult())"
                      >
                        设为当前帧
                      </el-button>
                    </template>
                  </el-input-number>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
          <el-button :icon="Plus" size="small" @click="addRecord"
            >添加抠色记录</el-button
          >
        </div>

        <!-- 全局：去边 / 质量 / 输出 -->
        <el-form
          v-if="ready"
          label-width="95px"
          label-position="right"
          class="params"
        >
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item>
                <template #label>
                  <div>
                    <span>去边</span>
                    <el-tooltip
                      placement="top"
                      effect="dark"
                      content="削掉残留背景边，0=不削"
                    >
                      <el-icon class="hint-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <el-input-number
                  v-model="erode"
                  :min="0"
                  :max="10"
                  controls-position="right"
                  @change="scheduleResult"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item>
                <template #label>
                  <div class="flex items-center">
                    <span>图片质量</span>
                    <el-tooltip
                      placement="top"
                      effect="dark"
                      content="图片质量 1–100，100=最高质量"
                    >
                      <el-icon class="hint-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <el-input-number
                  v-model="quality"
                  :min="1"
                  :max="100"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item>
                <template #label>
                  <div>
                    <span>剔除坏帧</span>
                    <el-tooltip placement="top" effect="dark">
                      <el-icon class="hint-icon"><QuestionFilled /></el-icon>
                      <template #content>
                        有些视频每隔若干帧有一张"关键帧"，因压缩块效应导致这一帧抠图边缘<br />
                        发毛、凹凸不平（其余帧正常）。勾选后导出时会自动识别并跳过这些<br />
                        边缘异常粗糙的帧并连续重新编号。猫咪是循环动画，丢几帧基本无感。
                      </template>
                    </el-tooltip>
                  </div>
                </template>
                <el-switch v-model="dropBadFrames" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="输出子目录">
            <el-input v-model="subdir" placeholder="相对资源根，如 idle/wink">
              <template #prepend>{{ root || "资源根" }}/</template>
            </el-input>
          </el-form-item>
        </el-form>

        <div v-if="ready" class="v2w__actions">
          <el-button
            type="primary"
            :icon="VideoPlay"
            :loading="running"
            :disabled="running || !subdir"
            @click="start"
          >
            {{ running ? "转换中…" : "开始转换" }}
          </el-button>
          <el-button v-if="running" type="danger" plain @click="cancel"
            >停止</el-button
          >
          <div v-if="running || done" class="v2w__progress">
            <el-progress
              :percentage="percent"
              :status="done ? 'success' : undefined"
            />
            <div class="v2w__stat">
              已转换 {{ savedCount }} / {{ totalFrames }} 帧 · 建议帧率 ≈
              {{ fpsGuess }}
            </div>
          </div>
        </div>
      </el-card>

      <!-- 离屏视频源 -->
      <video
        ref="videoEl"
        class="v2w__video"
        muted
        playsinline
        crossorigin="anonymous"
      />

      <!-- 抠图使用说明（独立组件）。 -->
      <ChromaKeyHelp v-model="helpVisible" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  VideoCamera,
  VideoPlay,
  Plus,
  Close,
  Pointer,
  MagicStick,
  QuestionFilled,
  Refresh,
} from "@element-plus/icons-vue";
import {
  processFrame,
  autoDetectKeyColors,
  edgeRoughness,
  type KeyColor,
  type KeyRegion,
} from "./chromaKey";
import { getCachedClip, setCachedClip } from "./frameCache";
import ChromaKeyHelp from "./ChromaKeyHelp.vue";

/** requestVideoFrameCallback 元数据。 */
interface VideoFrameMeta {
  mediaTime: number;
}
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (
    cb: (now: number, meta: VideoFrameMeta) => void,
  ) => number;
};

/**
 * 一条抠色记录：颜色 + 容差；scoped=true 时再限定矩形（百分比）+ 帧段（start/end 为帧号），且只对本条生效。
 * 第一条默认 scoped=false（全局：整幅、全程）。
 */
interface KeyRecord {
  /** 单个背景色（hex）。记录列表本身就是颜色列表。 */
  color: string;
  tolerance: number;
  scoped: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  end: number;
}

/** 加载时一次性缓存的所有帧（位图）及各帧时间戳（秒）。 */
let frames: ImageBitmap[] = [];
let times: number[] = [];
const FRAME_CAP = 1500;

const videoEl = ref<HTMLVideoElement | null>(null);
const origCanvas = ref<HTMLCanvasElement | null>(null);
const resultCanvas = ref<HTMLCanvasElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);

const root = ref("");
const videoPath = ref("");
const videoUrl = computed(() =>
  videoPath.value ? convertFileSrc(videoPath.value) : "",
);
const subdir = ref("");
const quality = ref(90);
const erode = ref(2);
/** 剔除坏帧：导出时跳过抠图边缘异常粗糙的帧（多为 H.264 关键帧的块噪声帧）。 */
const dropBadFrames = ref(true);
/** 抠图使用说明弹框。 */
const helpVisible = ref(false);

const decoding = ref(false);
const decodePercent = ref(0);
const ready = ref(false);
const duration = ref(0);
const totalFrames = ref(0);
const frameIndex = ref(0);
const fpsGuess = ref(0);
let videoW = 0;
let videoH = 0;
const dispW = ref(300);

/** 抠图设置：区域记录列表。 */
const records = ref<KeyRecord[]>([]);
/** 吸管模式 + 取色目标记录下标（-1=无）。 */
const picking = ref(false);
const pickTarget = ref(-1);

/** 吸管放大镜 canvas + 屏幕位置。 */
const pickPreview = ref<HTMLCanvasElement | null>(null);
const pickPreviewPos = reactive({ x: 0, y: 0 });
/** 吸管时的精确像素坐标（video 空间），鼠标/键盘共用。 */
const pickCursor = reactive({ x: 0, y: 0 });

// 右侧结果画布缩放/平移
const resultZoom = ref(1);
const resultPanX = ref(0);
const resultPanY = ref(0);
const dispH = computed(() =>
  videoW ? Math.round((videoH / videoW) * dispW.value) : 0,
);
const resultCanvasStyle = computed(() => ({
  transform: `translate(${resultPanX.value}px, ${resultPanY.value}px) scale(${resultZoom.value})`,
  transformOrigin: "0 0",
}));

const running = ref(false);
const done = ref(false);
const percent = ref(0);
const savedCount = ref(0);
let cancelled = false;

let lastOriginal: Uint8ClampedArray | null = null;
const curTime = computed(() => times[frameIndex.value] ?? 0);

onMounted(async () => {
  try {
    root.value = await invoke<string>("pet_get_resource_root");
  } catch {
    /* 忽略 */
  }
});
onUnmounted(() => {
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  freeFrames();
});
/** 只清本地引用，不 close 位图——位图归 frameCache 所有，淘汰时才释放。 */
function freeFrames() {
  frames = [];
  times = [];
}

/** hex ↔ rgb。 */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 177, 64];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function fmtTime(t: number): string {
  return isFinite(t) ? `${t.toFixed(2)}s` : "0.00s";
}

/** 某条记录在第 `frame` 帧是否生效（全局恒生效；限定区只在其帧段内）。 */
function activeAt(r: KeyRecord, frame: number): boolean {
  return !r.scoped || (frame >= r.start && frame <= r.end);
}

/** 第 `frame` 帧生效的抠色区域（喂给算法）。 */
function activeRegions(frame: number): KeyRegion[] {
  return records.value
    .filter((r) => r.color && activeAt(r, frame))
    .map((r) => {
      const [cr, cg, cb] = hexToRgb(r.color);
      return {
        rect: r.scoped
          ? { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h }
          : { x1: 0, y1: 0, x2: 100, y2: 100 },
        keys: [{ r: cr, g: cg, b: cb } as KeyColor],
        tolerance: r.tolerance,
      };
    });
}

/** 选择源视频并解码全部帧。 */
async function pickVideo() {
  try {
    const picked = await open({
      multiple: false,
      filters: [
        {
          name: "视频",
          extensions: ["mp4", "mov", "webm", "mkv", "avi", "m4v"],
        },
      ],
    });
    if (typeof picked !== "string") return;
    videoPath.value = picked;
    await loadAndDecode();
  } catch (e) {
    decoding.value = false;
    ElMessage.error(`处理视频失败：${e}`);
  }
}

/** 加载视频 → 逐帧解码缓存 → 就绪后建一条全局记录（自动识别背景色）并渲染。 */
async function loadAndDecode() {
  ready.value = false;
  done.value = false;
  freeFrames();

  const key = videoPath.value;
  const cached = getCachedClip(key);
  if (cached) {
    // 命中缓存（开发期改代码/重挂后复用），跳过整段解码。
    frames = cached.frames;
    times = cached.times;
    videoW = cached.videoW;
    videoH = cached.videoH;
    duration.value = cached.duration;
  } else {
    const video = videoEl.value as RVFCVideo;
    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const err = () => {
        cleanup();
        reject(new Error("视频加载失败"));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", ok);
        video.removeEventListener("error", err);
      };
      video.addEventListener("loadedmetadata", ok);
      video.addEventListener("error", err);
      video.src = videoUrl.value;
      video.load();
    });
    videoW = video.videoWidth;
    videoH = video.videoHeight;
    duration.value = video.duration || 0;

    decoding.value = true;
    decodePercent.value = 0;
    await decodeAllFrames(video);
    decoding.value = false;

    // 存入缓存（缓存持有这些位图；组件不再 close）。
    if (frames.length > 0) {
      setCachedClip(key, {
        frames,
        times,
        videoW,
        videoH,
        duration: duration.value,
      });
    }
  }
  dispW.value = Math.min(300, videoW);

  totalFrames.value = frames.length;
  fpsGuess.value =
    duration.value > 0 ? Math.round(frames.length / duration.value) : 0;
  if (frames.length === 0) {
    ElMessage.error("没有解码到任何帧");
    return;
  }

  ready.value = true;
  frameIndex.value = 0;
  await nextTick();
  const oc = origCanvas.value!;
  const rc = resultCanvas.value!;
  oc.width = rc.width = videoW;
  oc.height = rc.height = videoH;
  drawFrame(0);
  // 初始化：自动识别背景色，每个识别到的颜色 = 一条全局记录。
  const colors = lastOriginal
    ? autoDetectKeyColors(lastOriginal, videoW, videoH).map((c) =>
        rgbToHex(c.r, c.g, c.b),
      )
    : ["#00b140"];
  records.value = colors.map((color) => newRecord(color, false));
  renderResult();
}

/** 造一条记录（默认值集中在此）。 */
function newRecord(color: string, scoped: boolean): KeyRecord {
  return {
    color,
    tolerance: scoped ? 40 : 30,
    scoped,
    x: 30,
    y: 30,
    w: 25,
    h: 20,
    start: 0,
    end: Math.max(0, totalFrames.value - 1),
  };
}

/** 用 rVFC 暂停/续播逐帧推进，把每帧抓成 ImageBitmap 缓存。 */
function decodeAllFrames(video: RVFCVideo): Promise<void> {
  return new Promise((resolve) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      video.pause();
      resolve();
    };
    video.addEventListener("ended", stop, { once: true });
    const onFrame = async (_now: number, meta: VideoFrameMeta) => {
      if (stopped) return;
      video.pause();
      try {
        frames.push(await createImageBitmap(video));
        times.push(meta.mediaTime);
      } catch {
        /* 跳过坏帧 */
      }
      if (duration.value > 0) {
        decodePercent.value = Math.min(
          99,
          Math.round((meta.mediaTime / duration.value) * 100),
        );
      }
      if (frames.length >= FRAME_CAP) {
        stop();
        return;
      }
      video.requestVideoFrameCallback(onFrame);
      video.play().catch(() => {});
    };
    video.currentTime = 0;
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(() => {});
  });
}

/** 把缓存的第 i 帧画到左侧 canvas 并缓存原始像素。瞬时、不节流。 */
function drawFrame(i: number) {
  const oc = origCanvas.value;
  const bmp = frames[i];
  if (!oc || !bmp) return;
  const octx = oc.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(bmp, 0, 0, videoW, videoH);
  lastOriginal = octx.getImageData(0, 0, videoW, videoH).data.slice();
}

/** 把当前设置下的抠图结果渲染到右侧 canvas。 */
function renderResult() {
  if (!lastOriginal) return;
  const rc = resultCanvas.value;
  if (!rc) return;
  const rctx = rc.getContext("2d")!;
  const work = new ImageData(
    new Uint8ClampedArray(lastOriginal),
    videoW,
    videoH,
  );
  processFrame(
    work.data,
    videoW,
    videoH,
    activeRegions(frameIndex.value),
    erode.value,
  );
  rctx.putImageData(work, 0, 0);
}

// 右侧结果防抖：停手超过 300ms 才重算。
let debounceTimer: number | undefined;
function scheduleResult() {
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined;
    renderResult();
  }, 300);
}

/** 滑动时间轴：左侧瞬时画缓存帧，右侧防抖出结果。 */
function onScrub() {
  drawFrame(frameIndex.value);
  scheduleResult();
}

// ── 吸管 / 自动识别（按记录，单色） ──────────────────────────────
/** 开启吸管并把取色目标指向某条记录（再点一次关闭）。 */
function pickInto(i: number) {
  if (picking.value && pickTarget.value === i) {
    stopPicking();
  } else {
    picking.value = true;
    pickTarget.value = i;
    // 默认把光标放在画面中心，方便键盘直接微调。
    pickCursor.x = Math.floor(videoW / 2);
    pickCursor.y = Math.floor(videoH / 2);
    drawPickPreview();
    updatePickPreviewPos();
    document.addEventListener("keydown", onPickKey);
  }
}

/** 退出吸管模式，清理监听器。 */
function stopPicking() {
  picking.value = false;
  pickTarget.value = -1;
  pickPreviewPos.x = -9999;
  pickPreviewPos.y = -9999;
  document.removeEventListener("keydown", onPickKey);
}

/** 把当前 pickCursor 映射到 stage 内的屏幕坐标，更新放大镜位置（自动避边）。 */
function updatePickPreviewPos() {
  if (!pickPreview.value || !origCanvas.value || !stageEl.value) return;
  const oc = origCanvas.value;
  const rect = oc.getBoundingClientRect();
  const stageRect = stageEl.value.getBoundingClientRect();
  const localX = pickCursor.x * (rect.width / videoW);
  const localY = pickCursor.y * (rect.height / videoH);
  let nx = localX + 16;
  let ny = localY + 16;
  if (nx + pickPreview.value.width > stageRect.width)
    nx = localX - pickPreview.value.width - 8;
  if (ny + pickPreview.value.height > stageRect.height)
    ny = localY - pickPreview.value.height - 8;
  pickPreviewPos.x = nx;
  pickPreviewPos.y = ny;
}

/** 键盘控制吸管光标：方向键 1px 微调，Enter/Space 确认，Esc 取消。 */
function onPickKey(e: KeyboardEvent) {
  if (!picking.value) return;
  const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Escape"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();

  if (e.key === "Escape") {
    stopPicking();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    confirmPick();
    return;
  }

  // 方向键：每次移动 1 像素（Shift 时加速到 5 像素）。
  const step = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case "ArrowUp":
      pickCursor.y = Math.max(0, pickCursor.y - step);
      break;
    case "ArrowDown":
      pickCursor.y = Math.min(videoH - 1, pickCursor.y + step);
      break;
    case "ArrowLeft":
      pickCursor.x = Math.max(0, pickCursor.x - step);
      break;
    case "ArrowRight":
      pickCursor.x = Math.min(videoW - 1, pickCursor.x + step);
      break;
  }
  drawPickPreview();
  updatePickPreviewPos();
}

/** 根据当前 pickCursor 绘制放大镜预览。 */
function drawPickPreview() {
  if (!picking.value || !lastOriginal || !pickPreview.value) return;
  const grid = 7;
  const half = Math.floor(grid / 2);
  const scale = 15;
  const preview = pickPreview.value;
  preview.width = grid * scale;
  preview.height = grid * scale;
  const pctx = preview.getContext("2d")!;

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = pickCursor.x + dx;
      const py = pickCursor.y + dy;
      let r = 0, g = 0, b = 0;
      if (px >= 0 && px < videoW && py >= 0 && py < videoH) {
        const idx = (py * videoW + px) * 4;
        r = lastOriginal[idx];
        g = lastOriginal[idx + 1];
        b = lastOriginal[idx + 2];
      }
      pctx.fillStyle = `rgb(${r},${g},${b})`;
      pctx.fillRect((dx + half) * scale, (dy + half) * scale, scale, scale);
    }
  }

  // 中心十字准星：一条最细的蓝线。
  const cxP = half * scale + scale / 2;
  const cyP = half * scale + scale / 2;
  pctx.strokeStyle = "#ff00ff";
  pctx.lineWidth = 0.5;
  pctx.beginPath();
  pctx.moveTo(cxP, 0);
  pctx.lineTo(cxP, preview.height);
  pctx.moveTo(0, cyP);
  pctx.lineTo(preview.width, cyP);
  pctx.stroke();
}

/**
 * 鼠标在左侧原始画面上移动时，更新 pickCursor 并显示放大镜预览。
 */
function onCanvasMove(e: MouseEvent) {
  if (!picking.value || !lastOriginal || !pickPreview.value) return;
  const oc = origCanvas.value!;
  const rect = oc.getBoundingClientRect();
  pickCursor.x = Math.floor(((e.clientX - rect.left) / rect.width) * videoW);
  pickCursor.y = Math.floor(((e.clientY - rect.top) / rect.height) * videoH);

  drawPickPreview();
  updatePickPreviewPos();
}

/** 鼠标离开原始画面时隐藏放大镜。 */
function onCanvasLeave() {
  pickPreviewPos.x = -9999;
  pickPreviewPos.y = -9999;
}

/** 确认取色（键盘 Enter/Space 或鼠标点击）。 */
function confirmPick() {
  if (!picking.value || pickTarget.value < 0 || !lastOriginal) return;
  const i = (pickCursor.y * videoW + pickCursor.x) * 4;
  const r = records.value[pickTarget.value];
  if (r)
    r.color = rgbToHex(
      lastOriginal[i],
      lastOriginal[i + 1],
      lastOriginal[i + 2],
    );
  stopPicking();
  renderResult();
}

/** 点左侧原始画面取色——onCanvasMove 已把 pickCursor 同步到鼠标位置，直接确认即可。 */
function onCanvasClick() {
  if (!picking.value || pickTarget.value < 0 || !lastOriginal) return;
  confirmPick();
}
/** 自动识别：把该记录的颜色设为画面主背景色（四角第一个）。 */
function autoDetect(i: number) {
  if (!lastOriginal) return;
  const r = records.value[i];
  const det = autoDetectKeyColors(lastOriginal, videoW, videoH)[0];
  if (r && det) {
    r.color = rgbToHex(det.r, det.g, det.b);
    renderResult();
  }
}

// ── 记录增删 / 高级 ─────────────────────────────────────────────
function addRecord() {
  // 新增一条全局颜色记录（默认取画面主背景色，便于直接微调）；可在「高级」里改成限定区域。
  const det = lastOriginal
    ? autoDetectKeyColors(lastOriginal, videoW, videoH)[0]
    : null;
  records.value.push(
    newRecord(det ? rgbToHex(det.r, det.g, det.b) : "#00b140", false),
  );
  scheduleResult();
}
function removeRecord(i: number) {
  records.value.splice(i, 1);
  if (pickTarget.value === i) {
    stopPicking();
  } else if (pickTarget.value > i) {
    pickTarget.value--;
  }
  scheduleResult();
}
/**
 * 设置某条记录的「限定区域 / 时间」开关。
 * 折叠面板的开合即视作此开关，open=true 表示该条记录限定到自身的矩形 + 时间段。
 */
function setScoped(i: number, scoped: boolean) {
  records.value[i].scoped = scoped;
  scheduleResult();
}

// ── 区域框拖动 ──────────────────────────────────────────────────
function boxStyle(r: KeyRecord) {
  return {
    left: r.x + "%",
    top: r.y + "%",
    width: r.w + "%",
    height: r.h + "%",
  };
}
function startDrag(e: MouseEvent, r: KeyRecord, mode: "move" | "resize") {
  if (picking.value) return;
  const rect = stageEl.value!.getBoundingClientRect();
  const sx = e.clientX;
  const sy = e.clientY;
  const o = { x: r.x, y: r.y, w: r.w, h: r.h };
  const round1 = (v: number) => Math.round(v * 100) / 100; // 区域百分比保留 1 位小数
  const onMove = (ev: MouseEvent) => {
    const dx = ((ev.clientX - sx) / rect.width) * 100;
    const dy = ((ev.clientY - sy) / rect.height) * 100;
    if (mode === "move") {
      r.x = round1(Math.max(0, Math.min(100 - r.w, o.x + dx)));
      r.y = round1(Math.max(0, Math.min(100 - r.h, o.y + dy)));
    } else {
      r.w = round1(Math.max(2, Math.min(100 - r.x, o.w + dx)));
      r.h = round1(Math.max(2, Math.min(100 - r.y, o.h + dy)));
    }
    scheduleResult();
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function cancel() {
  cancelled = true;
}

// ── 右侧结果缩放 / 平移 ─────────────────────────────────────────
/** 重置右侧结果画布的缩放与平移到初始状态。 */
function resetResultView() {
  resultZoom.value = 1;
  resultPanX.value = 0;
  resultPanY.value = 0;
}

function onResultWheel(e: WheelEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const oldZoom = resultZoom.value;
  const newZoom = Math.max(
    0.1,
    Math.min(10, oldZoom * (e.deltaY > 0 ? 0.9 : 1.1)),
  );
  resultPanX.value = mx - (mx - resultPanX.value) * (newZoom / oldZoom);
  resultPanY.value = my - (my - resultPanY.value) * (newZoom / oldZoom);
  resultZoom.value = newZoom;
}
function onResultDragStart(e: MouseEvent) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const startPanX = resultPanX.value;
  const startPanY = resultPanY.value;
  const onMove = (ev: MouseEvent) => {
    resultPanX.value = startPanX + (ev.clientX - startX);
    resultPanY.value = startPanY + (ev.clientY - startY);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/** canvas → WebP 字节。 */
function encodeWebp(canvas: HTMLCanvasElement, q: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("WebP 编码失败"));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      },
      "image/webp",
      q,
    );
  });
}

/** 主流程：遍历缓存帧 → 抠图 → 编码 → 落盘。 */
async function start() {
  const rc = resultCanvas.value;
  if (!rc || !subdir.value || frames.length === 0) return;

  running.value = true;
  done.value = false;
  cancelled = false;
  percent.value = 0;
  savedCount.value = 0;

  let dir = "";
  try {
    dir = await invoke<string>("pet_converter_begin", {
      subdir: subdir.value,
      clear: true,
    });
  } catch (e) {
    running.value = false;
    ElMessage.error(`准备失败：${e}`);
    return;
  }

  const ctx = rc.getContext("2d", { willReadFrequently: true })!;
  const q = quality.value / 100;
  const er = erode.value;

  // 剔除坏帧：用最近若干个已保留帧的边缘锯齿度中位数做基准，明显偏高的判为坏帧跳过。
  const recent: number[] = [];
  const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  let out = 0; // 已写出的帧数（连续编号）
  let dropped = 0;

  try {
    for (let i = 0; i < frames.length; i++) {
      if (cancelled) break;
      ctx.drawImage(frames[i], 0, 0, videoW, videoH);
      const img = ctx.getImageData(0, 0, videoW, videoH);
      processFrame(img.data, videoW, videoH, activeRegions(i), er);

      // 坏帧判定：边缘锯齿度远高于近期基准 → 跳过（基准至少要有几帧才生效）。
      if (dropBadFrames.value) {
        const rough = edgeRoughness(img.data);
        if (recent.length >= 5 && rough > median(recent) * 1.35) {
          dropped++;
          percent.value = Math.round(((i + 1) / frames.length) * 100);
          continue;
        }
        recent.push(rough);
        if (recent.length > 15) recent.shift();
      }

      ctx.putImageData(img, 0, 0);
      const bytes = await encodeWebp(rc, q);
      const name = `frame_${String(out).padStart(6, "0")}.webp`;
      await invoke("pet_converter_write", {
        dir,
        name,
        data: Array.from(bytes),
      });
      out++;
      savedCount.value = out;
      percent.value = Math.round(((i + 1) / frames.length) * 100);
    }
  } catch (e) {
    running.value = false;
    ElMessage.error(`转换失败：${e}`);
    renderResult();
    return;
  }

  running.value = false;
  renderResult();
  if (cancelled) ElMessage.info(`已停止，已写入 ${savedCount.value} 帧`);
  else {
    done.value = true;
    const extra = dropped > 0 ? `（剔除 ${dropped} 帧坏帧）` : "";
    ElMessage.success(`完成：${savedCount.value} 帧已写入 ${dir}${extra}`);
  }
}
</script>

<style scoped lang="scss">
.v2w {
  min-height: 100vh;
  min-width: 700px;

  &__top {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 12px 16px;
    height: 54px;
    box-sizing: border-box;
    background: #fff;
    border-bottom: 1px solid var(--el-border-color-light);

    .v2w__title {
      font-size: 16px;
      font-weight: 600;
      margin-right: 8px;
    }

    .v2w__hint {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  &__body {
    padding: 16px;

    .preview {
      margin: 4px 0 14px;

      &__pair {
        display: flex;
        gap: 16px;
        flex-wrap: nowrap;
        align-items: flex-start;
      }

      &__col {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      &__label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }

      &__reset {
        /* 重置图标按钮：去掉 el-button 自带的内边距，紧贴文字。 */
        padding: 0;
        height: auto;
        min-height: 0;
        color: var(--el-text-color-secondary);
      }

      &__stage {
        position: relative;
        display: inline-block;
        line-height: 0;
        border: 1px solid var(--el-border-color-light);
        border-radius: 6px;
        overflow: hidden;

        &--checker {
          background-image:
            linear-gradient(45deg, #ddd 25%, transparent 25%),
            linear-gradient(-45deg, #ddd 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ddd 75%),
            linear-gradient(-45deg, transparent 75%, #ddd 75%);
          background-size: 16px 16px;
          background-position:
            0 0,
            0 8px,
            8px -8px,
            -8px 0;
        }

        &.is-picking {
          .preview__canvas {
            cursor: crosshair;
          }

          /* 吸管模式下隐藏所有蓝框，避免遮挡取色点。 */
          .wm {
            opacity: 0;
            pointer-events: none;
          }
        }
      }

      &__canvas {
        display: block;
        width: 100%;
        height: auto;
      }

      /* 吸管放大镜：跟随鼠标，显示 9×9 像素放大预览。 */
      &__pick-preview {
        position: absolute;
        pointer-events: none;
        z-index: 20;
        border: 2px solid #fff;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        image-rendering: pixelated;
      }
    }

    .wm {
      position: absolute;
      border: 1.5px dashed rgba(64, 140, 255, 0.95);
      background: rgba(64, 140, 255, 0.16);
      cursor: move;
      box-sizing: border-box;

      &--active {
        border-color: rgba(40, 110, 255, 1);
        background: rgba(40, 110, 255, 0.24);
      }

      &__tag {
        position: absolute;
        top: -1px;
        left: -1px;
        font-size: 10px;
        line-height: 1;
        padding: 1px 3px;
        background: rgba(40, 110, 255, 0.9);
        color: #fff;
        border-radius: 0 0 3px 0;
      }

      &__handle {
        position: absolute;
        right: -5px;
        bottom: -5px;
        width: 10px;
        height: 10px;
        background: #fff;
        border: 1.5px solid rgba(40, 110, 255, 1);
        border-radius: 2px;
        cursor: nwse-resize;
      }
    }

    .timeline {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 640px;
      margin-top: 8px;

      .el-slider {
        flex: 1;
      }

      &__t {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        white-space: nowrap;
      }
    }

    .recs {
      margin: 8px 0 4px;

      &__title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        margin-bottom: 8px;
      }

      .rec {
        border: 1px solid var(--el-border-color-light);
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 10px;

        &__head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        &__name {
          font-weight: 600;
        }

        &__sum {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }

        &__del {
          margin-left: auto;
        }

        /* 颜色 + 容差左右两栏的容器：避免内层 colors / row 各自的下边距叠加。 */
        &__pair {
          margin-bottom: 8px;

          .rec__colors {
            margin-bottom: 0;
            flex-shrink: 0;
            min-width: 330px;
          }
          .rec__row {
            margin-bottom: 0;
          }
        }

        &__colors {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 8px;

          .rec__colorbtn {
            padding: 0;

            .rec__colorpicker {
              :deep(.el-color-picker__trigger) {
                border: none;
              }
            }
          }
        }

        &__row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;

          :deep(.el-input-number) {
            flex: 1;

            .el-input__wrapper {
              padding-left: 8px;
            }
          }

          :deep(.el-input) {
            flex: 1;
          }
        }

        &__lbl {
          width: 50px;
          flex: none;
          text-align: right;
          color: var(--el-text-color-secondary);
          font-size: 13px;
        }

        &__lbl2 {
          color: var(--el-text-color-secondary);
          font-size: 12px;
        }

        &__hint {
          color: var(--el-text-color-secondary);
          font-size: 12px;
        }

        &__adv-collapse {
          /* 折叠组件融入记录卡片：去边框、收紧默认内边距。 */
          margin-top: 4px;
          border: none;

          :deep(.el-collapse-item__header) {
            height: 32px;
            line-height: 32px;
            font-size: 13px;
            font-weight: 600;
            color: var(--el-color-primary);
            border-bottom: none;

            /* 折叠箭头同步主题色，避免和标题脱节。 */
            .el-collapse-item__arrow {
              color: var(--el-color-primary);
            }
          }

          :deep(.el-collapse-item__wrap) {
            border-bottom: none;
            background: transparent;
          }

          :deep(.el-collapse-item__content) {
            padding: 8px;
            background: var(--el-fill-color-light);
            border-radius: 6px;
          }
        }
      }
    }

    .params {
      margin-top: 8px;
    }

    .v2w__actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .v2w__progress {
      max-width: 420px;
      flex: 1;
    }

    .v2w__stat {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    .v2w__video {
      position: absolute;
      left: -99999px;
      width: 1px;
      height: 1px;
    }
  }
}

/* 通用工具类 */
.grow {
  flex: 1;
}

.hint {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.hint-icon {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  cursor: help;
}

.keyitem {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
</style>
