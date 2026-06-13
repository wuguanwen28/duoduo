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
 * 片段库。端点为「大概值」，后续逐帧微调。睡觉素材是连续录像（241 帧 0..240）：
 *   趴下 0–189、呼吸 187–199、耳朵/尾巴从接缝 200 出发（耳朵到 214、尾巴走到 240）。
 */
export const CLIPS: Record<string, Clip> = {
  lieDown: { src: "sleep", range: [0, 190], fps: 36, label: "趴下" },
  wakeUp: { src: "sleep", range: [190, 0], fps: 36, label: "醒来" }, // 趴下倒放
  sleepBreathe: { src: "sleep", range: [187, 200], fps: 10, yoyo: true, label: "睡觉呼吸" },
  sleepEar: { src: "sleep", range: [200, 215], fps: 24, label: "睡觉耳朵" }, // 从接缝出发
  sleepTail: { src: "sleep", range: [200, 241], fps: 24, label: "睡觉尾巴" }, // 从接缝出发，走更远
  idleBlink: { src: "idle", range: [0, 50], fps: 24, label: "空闲眨眼" },
  idleBreathe: { src: "idle", range: [50, 80], fps: 24, label: "空闲呼吸" }, // 基底
  idleTail: { src: "idle", range: [80, 97], fps: 24, label: "空闲摇尾巴" }, // 接缝相邻，丝滑
  idleEar: { src: "idle", range: [97, IDLE_FRAMES.length], fps: 24, label: "空闲动耳朵" }, // 非相邻，离散
  wiki: { src: "wiki", range: [0, FRAMES.wiki.length], fps: 24, label: "wiki" },
  feed: { src: "feed", range: [0, FRAMES.feed.length], fps: 24, label: "投喂" },
};
