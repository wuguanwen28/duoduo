/**
 * 帧序列相似度 / 循环接缝检测。
 *
 * 用来在一组帧（通常是走路、跑步等循环动作）里找出"最接近、能重叠成循环"的一对。
 * 典型用途：为 base 循环动作挑选首尾帧，保证首尾衔接时不跳帧。
 *
 * 核心度量：**预乘 alpha 的 RGB 均方误差（MSE）**，按两帧前景并集像素数归一。
 * 透明像素 premult 后 RGB 为 0，自然把"形状不重叠"也算成色差，所以这个分数
 * 同时反映了「颜色接近」和「轮廓重合」。前景 IoU 作为辅助指标展示。
 *
 * 使用方式：
 *   const { running, candidates, period, run } = useFrameSimilarity()
 *   run(imageUrls)
 *
 * 图像通过 `<img>` + `drawImage` 取像素，所以 url 必须同源或支持 CORS；
 * 这里用 `convertFileSrc` 生成的 asset:// URL 是可以直接读像素的。
 */
import { ref } from 'vue'

/** 一对候选循环帧：i < j，gap = j - i。 */
export interface LoopCandidate {
  i: number
  j: number
  gap: number
  /** 预乘 alpha MSE，越低越像（每通道每像素，约 0–10000 量级）。 */
  mse: number
  /** 前景 IoU，越高轮廓越重合（0–1）。 */
  iou: number
}

/** 分析结果。 */
export interface SimilarityResult {
  /** 候选循环对列表，按相似度从高到低排序。 */
  candidates: LoopCandidate[]
  /** 检测到的主周期（每帧最佳后继 gap 的众数）。 -1 表示未检测到。 */
  period: number
  /** 总帧数。 */
  total: number
}

/** 降采样尺寸：宽度，高度按比例算。姿态相似度对低分辨率鲁棒。 */
const SAMPLE_W = 128

/**
 * 最小周期占总帧数的比例。
 * 太短的 gap 本质是"相邻两帧"，姿势几乎没变，算不上循环。
 * 默认取总帧数的 1/6（如 60 帧则最小约 10 帧），最少 6 帧兜底。
 */
const DEFAULT_MIN_GAP_RATIO = 1 / 6
const MIN_GAP_FLOOR = 6

/** 计算时用的帧数据：降采样后的 8 位 RGB + alpha 展平数组。 */
interface FrameData {
  /** 预乘 alpha 的 RGB，Float32，长度 w*h*3。 */
  premult: Float32Array
  /** alpha 通道，Uint8，长度 w*h。 */
  alpha: Uint8Array
  /** 前景像素数（alpha > 16 的像素数）。 */
  fgCount: number
  w: number
  h: number
}

/** 加载一张图并降采样到 SAMPLE_W，返回 premult/alpha/fgCount。 */
async function loadFrame(url: string, targetW: number): Promise<FrameData> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = (e) => reject(e)
  })
  const ratio = img.height / img.width
  const w = targetW
  const h = Math.max(1, Math.round(w * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h) // Uint8ClampedArray

  const n = w * h
  const premult = new Float32Array(n * 3)
  const alpha = new Uint8Array(n)
  let fgCount = 0
  for (let px = 0, di = 0; px < n; px++, di += 4) {
    const r = data[di]
    const g = data[di + 1]
    const b = data[di + 2]
    const a = data[di + 3]
    alpha[px] = a
    if (a > 16) fgCount++
    const k = a / 255
    premult[px * 3] = r * k
    premult[px * 3 + 1] = g * k
    premult[px * 3 + 2] = b * k
  }
  return { premult, alpha, fgCount, w, h }
}

/**
 * 计算两张帧的相似度：
 * - 交集：两帧都是前景的像素数
 * - 并集：任一帧是前景的像素数
 * - 距离：在并集像素上取预乘 alpha RGB 的 MSE（按并集像素数归一）
 */
function computePair(a: FrameData, b: FrameData): { mse: number; iou: number } {
  const n = a.w * a.h
  let inter = 0
  let union = 0
  let sumSqDiff = 0
  const ap = a.premult
  const bp = b.premult
  const aa = a.alpha
  const ba = b.alpha
  for (let px = 0; px < n; px++) {
    const af = aa[px] > 16
    const bf = ba[px] > 16
    if (!af && !bf) continue
    if (af && bf) inter++
    union++
    const i = px * 3
    const dr = ap[i] - bp[i]
    const dg = ap[i + 1] - bp[i + 1]
    const db = ap[i + 2] - bp[i + 2]
    sumSqDiff += dr * dr + dg * dg + db * db
  }
  const denom = Math.max(union, 1) * 3
  return { mse: sumSqDiff / denom, iou: inter / Math.max(union, 1) }
}

/**
 * 完整分析：加载所有帧 → 算距离矩阵 → 找主周期 → 出 Top-N 候选。
 *
 * @param urls 帧 URL 列表，按时间顺序
 * @param minGap 最小帧间距（默认 6）
 * @param topK  返回多少个候选
 * @param onProgress 进度回调 (0..1)
 */
export async function analyzeFrames(
  urls: string[],
  minGap?: number,
  topK = 10,
  onProgress?: (p: number) => void,
): Promise<SimilarityResult> {
  const N = urls.length
  if (N < 2) return { candidates: [], period: -1, total: N }

  // 没传 minGap 就按比例算：总帧数的 1/6，最少 6 帧
  const gap =
    minGap ?? Math.max(MIN_GAP_FLOOR, Math.floor(N * DEFAULT_MIN_GAP_RATIO))

  // 1) 加载并降采样
  const frames: FrameData[] = []
  for (let i = 0; i < N; i++) {
    frames.push(await loadFrame(urls[i], SAMPLE_W))
    onProgress?.(0.1 + 0.2 * (i / N))
  }

  // 2) 距离矩阵（上三角，i < j && j-i >= gap）
  //    为了省内存只在需要时算，边算边记录最小和候选。
  const all: LoopCandidate[] = []
  // 每帧的最佳后继（用来统计周期）
  const bestGapFor: number[] = new Array(N).fill(-1)
  const bestGapD: number[] = new Array(N).fill(Infinity)

  // 估算总工作量：上三角元素数
  const totalPairs = Math.max(1, ((N - gap) * (N - gap + 1)) / 2)
  let done = 0

  for (let i = 0; i < N; i++) {
    for (let j = i + gap; j < N; j++) {
      const { mse, iou } = computePair(frames[i], frames[j])
      all.push({ i, j, gap: j - i, mse, iou })
      if (mse < bestGapD[i]) {
        bestGapD[i] = mse
        bestGapFor[i] = j - i
      }
      done++
      if (done % 200 === 0) {
        // 让出主线程，避免卡 UI
        await new Promise((r) => setTimeout(r, 0))
        onProgress?.(0.3 + 0.7 * (done / totalPairs))
      }
    }
  }

  // 3) 主周期：每帧最佳后继 gap 的众数
  const gapCounts = new Map<number, number>()
  for (let i = 0; i < N; i++) {
    const g = bestGapFor[i]
    if (g < gap) continue
    gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1)
  }
  let period = -1
  let bestCount = 0
  for (const [g, c] of gapCounts) {
    if (c > bestCount) {
      bestCount = c
      period = g
    }
  }

  // 4) 候选排序：先按 mse 升序
  all.sort((a, b) => a.mse - b.mse)

  // 5) 去重同一段：如果候选 (i,j) 和 (i+1,j+1) 都在列表里，只留最好的
  //    用一个简单去重：gap 相近 + 起点相近 合并
  const picked: LoopCandidate[] = []
  for (const c of all) {
    const dup = picked.some(
      (p) => Math.abs(p.gap - c.gap) <= 1 && Math.abs(p.i - c.i) <= 1,
    )
    if (dup) continue
    picked.push(c)
    if (picked.length >= topK) break
  }

  onProgress?.(1)
  return { candidates: picked, period, total: N }
}

/**
 * Vue composable 包装：暴露响应式状态和 run 方法。
 */
export function useFrameSimilarity() {
  const running = ref(false)
  const progress = ref(0)
  const candidates = ref<LoopCandidate[]>([])
  const period = ref(-1)
  const total = ref(0)
  const error = ref('')

  async function run(urls: string[], minGap?: number, topK = 10) {
    running.value = true
    error.value = ''
    progress.value = 0
    try {
      const result = await analyzeFrames(urls, minGap, topK, (p) => {
        progress.value = p
      })
      candidates.value = result.candidates
      period.value = result.period
      total.value = result.total
    } catch (e) {
      error.value = String(e)
      candidates.value = []
      period.value = -1
    } finally {
      running.value = false
    }
  }

  return { running, progress, candidates, period, total, error, run }
}
