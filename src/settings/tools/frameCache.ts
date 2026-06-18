/**
 * 解码帧缓存（开发期用）—— 按视频路径缓存逐帧解码结果，避免改代码触发 HMR / 组件
 * 重挂后又得重新把视频解码一遍。
 *
 * 关键点：缓存**持有**这些 `ImageBitmap`，组件只是借用、**不负责 close**；位图只在
 * 被本缓存淘汰时才释放。这样 HMR/重挂后旧位图依然有效。
 *
 * 跨 HMR 保活：把 Map 存进 `import.meta.hot.data`，热更替换本模块时取回上次的实例。
 */
export interface CachedClip {
  frames: ImageBitmap[];
  times: number[];
  videoW: number;
  videoH: number;
  duration: number;
}

/** 最多缓存的视频数；超出按最久未用淘汰并释放其位图。 */
const MAX = 3;

const store: Map<string, CachedClip> =
  (import.meta.hot?.data.frameCache as Map<string, CachedClip> | undefined) ??
  new Map<string, CachedClip>();
if (import.meta.hot) import.meta.hot.data.frameCache = store;

/** 取某视频的缓存帧（命中即可跳过解码）。 */
export function getCachedClip(key: string): CachedClip | undefined {
  const clip = store.get(key);
  if (clip) {
    // 触达即视为最近使用：重新插到末尾。
    store.delete(key);
    store.set(key, clip);
  }
  return clip;
}

/** 写入某视频的缓存帧，并按上限淘汰最久未用的（释放其位图）。 */
export function setCachedClip(key: string, clip: CachedClip): void {
  store.delete(key);
  store.set(key, clip);
  while (store.size > MAX) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined || oldest === key) break;
    store.get(oldest)?.frames.forEach((f) => f.close());
    store.delete(oldest);
  }
}
