/**
 * 帧加载器 —— 为每个精灵图集急切（eager）导入精灵帧。
 *
 * Vite 要求 `import.meta.glob` 的模式必须是静态字符串字面量，因此每个目录
 * 都有各自显式的 glob。帧采用零填充的 6 位数字命名（`frame_000000.webp` …），
 * 而字典序恰好等于数字顺序，所以 `Object.keys(...).sort()` 会按播放顺序
 * 返回帧 —— 数组索引即等于帧号。
 *
 * 添加新动作的步骤：
 * 1. 将帧以 `frame_XXXXXX.webp` 命名放入 `src/assets/<new-dir>/`。
 * 2. 复制下方的一个 glob 块，替换其中的目录名。
 * 3. 将该键添加到 `FRAMES` 记录中，然后在 `./clips.ts` 的 `SOURCES` 里登记它。
 */

/** 辅助函数：将 glob 结果映射转换为按帧顺序排列的 URL 数组。 */
function toFrameList(map: Record<string, string>): string[] {
  return Object.keys(map)
    .sort()
    .map((k) => map[k]);
}

/** 跟随 / 注视帧 —— 跟踪光标的精灵循环（169 帧）。 */
const followFrames = import.meta.glob<string>("../assets/cat-webp/*.webp", {
  eager: true,
  import: "default",
});

/** 空闲帧 —— 当猫无事可做时显示的休息循环。 */
const idleFrames = import.meta.glob<string>("../assets/cat-idla-hd/*.webp", {
  eager: true,
  import: "default",
});

/** 动作帧集（每个动作对应一个目录）。 */
const wikiFrames = import.meta.glob<string>("../assets/cat-wiki/*.webp", {
  eager: true,
  import: "default",
});

const sleepFrames = import.meta.glob<string>("../assets/cat-sleep/*.webp", {
  eager: true,
  import: "default",
});

const feedFrames = import.meta.glob<string>("../assets/cat-feed/*.webp", {
  eager: true,
  import: "default",
});

/**
 * 注视 / 跟随行为所用的帧。与动作的 FRAMES 分开存放，因为它由光标角度
 * 驱动（见 `useGaze`），而非 fps 定时器。
 */
export const FOLLOW_FRAMES: string[] = toFrameList(followFrames);

/**
 * 空闲休息循环所用的帧。由 fps 定时器驱动（见 `useCatBrain` 的空闲状态），
 * 永久循环，直到猫醒来去跟随或播放某个动作。
 */
export const IDLE_FRAMES: string[] = toFrameList(idleFrames);

/** 动作帧来源 → 有序的帧 URL。键由 `./clips.ts` 的 `SOURCES` 引用（如 sleep、wiki）。 */
export const FRAMES: Record<string, string[]> = {
  wiki: toFrameList(wikiFrames),
  sleep: toFrameList(sleepFrames),
  feed: toFrameList(feedFrames),
};
