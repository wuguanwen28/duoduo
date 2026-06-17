/**
 * 动作库访问层 —— 从外置资源仓库（`../store/resources`）读取解析后的动作。
 *
 * 旧版在这里用「大序列切区间」定义片段；现在每个动作是一个独立帧文件夹，
 * 由 manifest.json 的 actions 声明、由 store 解析，这里只做读取与小工具封装。
 */
import { getModel, type ResolvedClip } from "../store/resources";

export type { ResolvedClip };

/** 取一个动作；不存在返回 undefined。 */
export function getClip(name: string): ResolvedClip | undefined {
  return getModel().actions[name];
}

/**
 * 解析出最终播放帧序列：yoyo 则展开成「正放 + 反放（去重端点）」来回一遍。
 * reverse（倒放）已在加载时应用到 `clip.frames`，此处不再处理方向。
 */
export function clipFrames(clip: ResolvedClip): string[] {
  const f = clip.frames;
  if (clip.yoyo && f.length > 2) return [...f, ...f.slice(1, -1).reverse()];
  return f;
}

/** 视觉变换：平移（占精灵直径比例）+ 缩放。 */
export interface SourceTransform {
  /** 水平偏移＝相对精灵直径的比例：负＝往左、正＝往右。 */
  offsetX: number;
  /** 垂直偏移＝相对精灵直径的比例：负＝往上、正＝往下。 */
  offsetY: number;
  /** 额外缩放系数：1＝原样，>1 放大，<1 缩小。 */
  scale: number;
}

/** 默认变换：不偏不缩。 */
const IDENTITY_TRANSFORM: SourceTransform = { offsetX: 0, offsetY: 0, scale: 1 };

/** 取某动作的视觉变换；动作未知时返回默认（不偏不缩）。 */
export function transformOfAction(name: string | undefined): SourceTransform {
  if (!name) return IDENTITY_TRANSFORM;
  const c = getModel().actions[name];
  if (!c) return IDENTITY_TRANSFORM;
  return { offsetX: c.offsetX, offsetY: c.offsetY, scale: c.scale };
}

/** 由帧 URL 反查它属于哪个动作；不属于任何动作（如跟随帧）时返回 undefined。 */
export function actionOfFrame(url: string): string | undefined {
  return getModel().frameToAction.get(url);
}
