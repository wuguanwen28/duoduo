/**
 * 片段库 —— 所有「最小动画单元」的声明式定义。
 *
 * 一个片段（Clip）就是「从某个帧来源里截一段、以某 fps 播放」。方向藏在区间里：
 *   range:[a,b] 且 a <= b ：正放，帧 a..b-1
 *   range:[a,b] 且 a >  b ：倒放，帧 a-1..b（即把 [b,a) 倒过来）
 * 例：趴下 [0,190] 正放 0..189；醒来 [190,0] 倒放 189..0（＝趴下反着播）。
 *
 * 行为库（见 `./behaviors.ts`）按名字引用这些片段来编排播放。
 */
import { FRAMES, IDLE_FRAMES } from "./frames";

/** 帧来源键 → 帧 URL 数组。新增来源时在此登记。 */
export const SOURCES: Record<string, string[]> = {
  sleep: FRAMES.sleep,
  idle: IDLE_FRAMES,
  wiki: FRAMES.wiki,
  feed: FRAMES.feed,
};

/**
 * 来源视觉对齐 —— 不同文件夹的素材是分别生成/导出的，猫在画面里的位置和大小
 * 未必一致（比如 `idla_1080` 整体偏右、偏大）。这里给每个来源一份「视觉微调」，
 * 渲染时按当前帧所属来源应用到精灵图上，使各来源切换时画面对齐、不跳动。
 *
 * 注意：这只是「视觉层」的平移/缩放，不参与注视角度、点击命中、屏幕边界等计算
 *（那些仍以基准精灵为准）。跟随光标用的 `cat-webp` 是基准、不在本表中，故不偏不缩。
 */
export interface SourceTransform {
  /** 水平偏移＝相对精灵直径的比例：负＝往左、正＝往右。默认 0。 */
  offsetX: number;
  /** 垂直偏移＝相对精灵直径的比例：负＝往上、正＝往下。默认 0。 */
  offsetY: number;
  /** 额外缩放系数：1＝原样，>1 放大，<1 缩小。默认 1。 */
  scale: number;
}

/** 默认变换：不偏不缩。未在 `SOURCE_TRANSFORMS` 登记的来源都用它。 */
const IDENTITY_TRANSFORM: SourceTransform = { offsetX: 0, offsetY: 0, scale: 1 };

/**
 * 来源键 → 视觉微调（只需写要改的字段，其余取默认）。
 * 想让某来源的猫往左挪并放大，例如：`idle: { offsetX: -0.05, scale: 1.1 }`。
 * 偏移单位是「精灵直径的比例」，所以缩放滑块拉大拉小都保持同样的相对位置。
 */
export const SOURCE_TRANSFORMS: Record<string, Partial<SourceTransform>> = {
  // idle（idla_1080）：按实际素材逐步微调下面三个值即可。
  idle: { offsetX: -0.01, offsetY: -0.01, scale: 1 },
};

/** 取某来源的视觉变换（与默认值合并）。来源未知时返回默认（不偏不缩）。 */
export function transformOfSource(src: string | undefined): SourceTransform {
  return { ...IDENTITY_TRANSFORM, ...(src ? SOURCE_TRANSFORMS[src] : undefined) };
}

/** 帧 URL → 来源键的反查表，模块加载时一次性建好（帧 URL 在各来源间互不重复）。 */
const FRAME_TO_SOURCE = new Map<string, string>();
for (const [key, frames] of Object.entries(SOURCES)) {
  for (const url of frames) FRAME_TO_SOURCE.set(url, key);
}

/** 由帧 URL 反查它属于哪个来源；不属于任何已登记来源（如基准跟随帧）时返回 undefined。 */
export function sourceOfFrame(url: string): string | undefined {
  return FRAME_TO_SOURCE.get(url);
}

/** 一个最小动画单元。 */
export interface Clip {
  /** 帧来源键（`SOURCES` 的键）。 */
  src: string;
  /** 帧区间 [a,b]，左闭右开；a<=b 正放，a>b 倒放（方向即播放方向）。 */
  range: [number, number];
  /** 播放速度（fps）。 */
  fps: number;
  /** yoyo 来回（正放+反放、去重端点），默认 false。 */
  yoyo?: boolean;
  /** 可读标签（调试 / 中文名）。 */
  label?: string;
}

/**
 * 把片段解析成有序的帧 URL 数组。
 * 先按方向取序列（正/倒放），再按需做 yoyo 来回拼接。
 */
export function resolveClip(clip: Clip): string[] {
  const src = SOURCES[clip.src] ?? [];
  const [a, b] = clip.range;
  let seq = a <= b ? src.slice(a, b) : src.slice(b, a).reverse();
  if (clip.yoyo && seq.length > 2) {
    seq = [...seq, ...seq.slice(1, -1).reverse()];
  }
  return seq;
}

/**
 * 片段库。端点为「大概值」，后续逐帧微调。
 * 睡觉素材原为 241 帧，已删除 5 张破损帧（原帧号 10/60/110/160/210），现 236 帧。
 * 因 toFrameList 会把剩余帧重新紧凑编号（下标不再等于原帧号），下方睡觉区间是按
 * 「删点之前有几个删除」前移后的下标，保持画面内容与原先一致：
 *   趴下 0–185、呼吸 183–195、耳朵/尾巴从接缝 196 出发（尾巴走到末帧 length）。
 */
export const CLIPS: Record<string, Clip> = {
  lieDown: { src: "sleep", range: [0, 186], fps: 36, label: "趴下" },
  wakeUp: { src: "sleep", range: [186, 0], fps: 36, label: "醒来" }, // 趴下倒放
  sleepBreathe: {
    src: "sleep",
    range: [183, 196],
    fps: 10,
    yoyo: true,
    label: "睡觉呼吸",
  },
  sleepEar: { src: "sleep", range: [196, 210], fps: 24, label: "睡觉耳朵" }, // 从接缝出发
  sleepTail: { src: "sleep", range: [196, FRAMES.sleep.length], fps: 24, label: "睡觉尾巴" }, // 从接缝出发，走到末帧
  idleBlink: { src: "idle", range: [0, 50], fps: 24, label: "空闲眨眼" },
  idleBreathe: { src: "idle", range: [45, 80], fps: 24, yoyo: true, label: "空闲呼吸" }, // 基底
  idleTail: { src: "idle", range: [80, 97], fps: 24, label: "空闲摇尾巴" }, // 接缝相邻，丝滑
  idleEar: {
    src: "idle",
    range: [97, IDLE_FRAMES.length],
    fps: 24,
    label: "空闲动耳朵",
  }, // 非相邻，离散
  wiki: { src: "wiki", range: [0, FRAMES.wiki.length], fps: 24, label: "wiki" },
  feed: { src: "feed", range: [0, FRAMES.feed.length], fps: 24, label: "投喂" },
};
