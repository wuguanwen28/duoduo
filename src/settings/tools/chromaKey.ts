/**
 * 抠背景（统一的「区域抠色」模型）。
 *
 * 抠图是一组「区域记录」：每条 = 一个矩形范围（全屏=整幅）+ 一组背景色 + 容差。
 * 全局抠图就是"全屏区域"。一个像素只要命中任一区域（在其矩形内、且颜色匹配）即算
 * 背景。匹配按**色相 + 饱和度**判定（同色深浅一起抠、白/灰不误清），外加 RGB 近距
 * 兜底（灰/白幕）。最后做形态学去噪、补洞、内缩去边、羽化，并去溢色压掉绿/蓝残边。
 */

/** 一个背景色（RGB 0–255）。 */
export interface KeyColor {
  r: number
  g: number
  b: number
}

/** 矩形（百分比 0–100，相对画面宽高）。 */
export interface ClearRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 一条抠色区域：在 `rect` 范围内按 `keys`/`tolerance` 抠背景。全屏区 rect=0,0,100,100。 */
export interface KeyRegion {
  rect: ClearRect
  keys: KeyColor[]
  tolerance: number
}

/** RGB → HSV：h 0–360，s 0–1，v 0–1。 */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const v = max / 255
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }
  return [h, s, v]
}

/** 色相圆周差（0–180）。 */
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** 每个背景色预计算的判定信息。 */
interface KeyInfo {
  h: number
  s: number
  r: number
  g: number
  b: number
}

function toKeyInfos(keys: KeyColor[]): KeyInfo[] {
  return keys.map((k) => {
    const [kh, ks] = rgbToHsv(k.r, k.g, k.b)
    return { h: kh, s: ks, r: k.r, g: k.g, b: k.b }
  })
}

const SAT_MIN = 0.12 // 低于此饱和度（白/灰）不靠色相判定，避免误清

/** 像素是否命中某组背景色（色相接近且够鲜艳，或 RGB 距离很近）。 */
function hitKeys(
  r: number,
  g: number,
  b: number,
  ph: number,
  ps: number,
  keys: KeyInfo[],
  hueTol: number,
  rgbClose2: number,
): boolean {
  for (const k of keys) {
    if (ps >= SAT_MIN && hueDist(ph, k.h) <= hueTol) return true
    const dr = r - k.r
    const dg = g - k.g
    const db = b - k.b
    if (dr * dr + dg * dg + db * db <= rgbClose2) return true
  }
  return false
}

const hueTolOf = (t: number) => (t / 100) * 70
const rgb2Of = (t: number) => ((t / 100) * 110) ** 2

/** 区域的运行时形态（像素范围 + 预计算判定信息）。 */
interface RegionRT {
  x1: number
  y1: number
  x2: number
  y2: number
  keys: KeyInfo[]
  hueTol: number
  rgb2: number
}

function toRegionRT(regions: KeyRegion[], w: number, h: number): RegionRT[] {
  return regions
    .filter((z) => z.keys.length > 0)
    .map((z) => {
      const ax = Math.round((z.rect.x1 / 100) * w)
      const bx = Math.round((z.rect.x2 / 100) * w)
      const ay = Math.round((z.rect.y1 / 100) * h)
      const by = Math.round((z.rect.y2 / 100) * h)
      return {
        x1: Math.max(0, Math.min(ax, bx)),
        x2: Math.min(w, Math.max(ax, bx)),
        y1: Math.max(0, Math.min(ay, by)),
        y2: Math.min(h, Math.max(ay, by)),
        keys: toKeyInfos(z.keys),
        hueTol: hueTolOf(z.tolerance),
        rgb2: rgb2Of(z.tolerance),
      }
    })
}

/** 背景掩码：像素落在任一区域矩形内且命中该区域颜色 → 255。 */
function bgMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  Z: RegionRT[],
): Uint8Array {
  const m = new Uint8Array(w * h)
  if (Z.length === 0) return m
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = y * w + x
      const i = px * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const [ph, ps] = rgbToHsv(r, g, b)
      let hit = false
      for (const z of Z) {
        if (
          x >= z.x1 &&
          x < z.x2 &&
          y >= z.y1 &&
          y < z.y2 &&
          hitKeys(r, g, b, ph, ps, z.keys, z.hueTol, z.rgb2)
        ) {
          hit = true
          break
        }
      }
      m[px] = hit ? 255 : 0
    }
  }
  return m
}

/** 3×3 最小/最大滤波：erode=腐蚀，否则膨胀。边缘 clamp。 */
function minmax3(
  src: Uint8Array,
  w: number,
  h: number,
  erode: boolean,
): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = erode ? 255 : 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy))
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx))
          const s = src[yy * w + xx]
          val = erode ? Math.min(val, s) : Math.max(val, s)
        }
      }
      out[y * w + x] = val
    }
  }
  return out
}

const erode3 = (m: Uint8Array, w: number, h: number) => minmax3(m, w, h, true)
const dilate3 = (m: Uint8Array, w: number, h: number) => minmax3(m, w, h, false)

/** 补洞：从角 (0,0) 灌水，连边缘的才算真背景；主体上孤立的同色洞补回前景。 */
function fillHoles(fg: Uint8Array, w: number, h: number): void {
  if (fg[0] !== 0) return
  const reached = new Uint8Array(w * h)
  const stack: number[] = [0]
  reached[0] = 1
  while (stack.length) {
    const idx = stack.pop()!
    const x = idx % w
    const y = (idx / w) | 0
    const neigh = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ]
    for (const n of neigh) {
      if (n >= 0 && reached[n] === 0 && fg[n] === 0) {
        reached[n] = 1
        stack.push(n)
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (fg[i] === 0 && reached[i] === 0) fg[i] = 255
  }
}

/** 3×3 高斯羽化。 */
function gaussian3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy))
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx))
          const wgt = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)
          sum += src[yy * w + xx] * wgt
        }
      }
      out[y * w + x] = (sum / 16) | 0
    }
  }
  return out
}

/**
 * 取去溢色要压的通道：仅当背景色确实是"鲜艳的绿幕/蓝幕色"时返回绿(1)/蓝(2)，
 * 否则返回 -1（不去溢色）。黑/灰/低饱和/非绿蓝的 key 不做去溢色，避免改主体颜色。
 */
function despillChannel(regions: KeyRegion[]): -1 | 1 | 2 {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const z of regions)
    for (const k of z.keys) {
      r += k.r
      g += k.g
      b += k.b
      n++
    }
  if (n === 0) return -1
  r /= n
  g /= n
  b /= n
  const dom = g >= r && g >= b ? 1 : b >= r && b >= g ? 2 : 0
  const domV = dom === 1 ? g : dom === 2 ? b : r
  const second = Math.max(...[r, g, b].filter((_, i) => i !== dom))
  // 仅对绿/蓝主导、且明显高出另两通道、且够亮的背景色去溢色。
  if ((dom === 1 || dom === 2) && domV - second >= 40 && domV >= 60) return dom
  return -1
}

/**
 * 对一帧 RGBA 原地抠图。处理后 `data` 即为带透明通道的结果。
 * @param regions 当前帧生效的抠色区域（已按时间筛过；全屏区 rect=0,0,100,100）。
 * @param erode   去边内缩像素，0=不内缩。
 */
export function processFrame(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  regions: KeyRegion[],
  erode: number,
): void {
  const Z = toRegionRT(regions, w, h)

  // 1) 背景掩码 + 形态学开/闭去噪
  let bg = bgMask(data, w, h, Z)
  bg = dilate3(erode3(bg, w, h), w, h)
  bg = erode3(dilate3(bg, w, h), w, h)

  // 2) 前景 = 非背景
  const fg = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) fg[i] = bg[i] ? 0 : 255

  // 3) 补洞
  fillHoles(fg, w, h)

  // 4) 内缩去边
  let solid: Uint8Array = fg
  for (let k = 0; k < erode; k++) solid = erode3(solid, w, h)

  // 5) 羽化得 alpha
  const alpha = gaussian3(solid, w, h)

  // 6) 去溢色 + 写回 alpha。
  // 去溢色只在「生效区域矩形内」做：全屏记录覆盖全图，只开局部记录时仅框内；
  // 框外完全不动（保持原色），避免没框选的背景被去溢色压成灰色。
  const inRegion = new Uint8Array(w * h)
  for (const z of Z) {
    for (let y = z.y1; y < z.y2; y++) {
      const row = y * w
      for (let x = z.x1; x < z.x2; x++) inRegion[row + x] = 1
    }
  }
  const dom = despillChannel(regions) // -1 / 1(绿) / 2(蓝)
  const o1 = 0 // R 永远是另两通道之一（dom 只会是绿或蓝）
  const o2 = dom === 1 ? 2 : 1
  for (let i = 0, px = 0; px < w * h; px++, i += 4) {
    if (dom >= 0 && inRegion[px]) {
      const c = data[i + dom]
      const a = data[i + o1]
      const b = data[i + o2]
      if (c > a && c > b) data[i + dom] = Math.max(a, b)
    }
    data[i + 3] = alpha[px]
  }
}

/**
 * 抠图边缘的"锯齿度"：统计 alpha 半透明边界像素（既非全透明也非全不透明）的数量。
 * H.264 关键帧(I 帧)因块效应，边缘被切成方块锯齿，半透明边界像素会明显多于相邻
 * 的平滑帧。导出时用它识别并剔除这些"坏帧"。须在 processFrame 之后对其结果调用。
 */
export function edgeRoughness(rgba: Uint8ClampedArray): number {
  let cnt = 0
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i]
    if (a > 16 && a < 240) cnt++
  }
  return cnt
}

/**
 * 自动识别背景色：采样画面四角各一小块，取每角平均色并去重，返回最多 4 个候选。
 */
export function autoDetectKeyColors(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): KeyColor[] {
  const patch = Math.max(2, Math.floor(Math.min(w, h) * 0.05))
  const corners: [number, number][] = [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ]
  const out: KeyColor[] = []
  for (const [cx, cy] of corners) {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = cy; y < cy + patch && y < h; y++) {
      for (let x = cx; x < cx + patch && x < w; x++) {
        const i = (y * w + x) * 4
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
        n++
      }
    }
    if (n === 0) continue
    const c = {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
    }
    const dup = out.some((o) => {
      const dr = o.r - c.r
      const dg = o.g - c.g
      const db = o.b - c.b
      return dr * dr + dg * dg + db * db < 900
    })
    if (!dup) out.push(c)
  }
  return out.length ? out : [{ r: 0, g: 177, b: 64 }]
}
