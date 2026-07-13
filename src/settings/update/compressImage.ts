/**
 * 反馈图片压缩：把任意图片压到单张 ≤2MB 的 WebP。
 * 策略：最大边 ≤1920 等比缩放 → WebP q0.8 → 仍超 2MB 则降 q0.6/0.4 → 再缩尺寸，循环到底。
 * 触底仍超 2MB 抛 Error('图片过大')。
 */

/** 单张上限 2MB */
const MAX_BYTES = 2 * 1024 * 1024
/** 尺寸阶梯（最大边 px） */
const SIZE_STEPS = [1920, 1600, 1280, 960, 720]
/** quality 阶梯 */
const QUAL_STEPS = [0.8, 0.6, 0.4]

/** 把 File 解码成 HTMLImageElement */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

/** 计算缩放后的画布尺寸 */
function scaledSize(w: number, h: number, maxEdge: number): [number, number] {
  if (w <= maxEdge && h <= maxEdge) return [w, h]
  const ratio = w >= h ? maxEdge / w : maxEdge / h
  return [Math.round(w * ratio), Math.round(h * ratio)]
}

/**
 * 压缩单张图片。返回 WebP 字节与 mime。
 * 触底仍 >2MB 抛 Error('图片过大')。
 */
export async function compressImage(
  file: File,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const img = await loadImage(file)
  for (const maxEdge of SIZE_STEPS) {
    const [w, h] = scaledSize(img.naturalWidth, img.naturalHeight, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D 上下文不可用')
    ctx.drawImage(img, 0, 0, w, h)
    for (const q of QUAL_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', q),
      )
      if (!blob) continue
      const buf = new Uint8Array(await blob.arrayBuffer())
      if (buf.byteLength <= MAX_BYTES) {
        return { bytes: buf, mime: 'image/webp' }
      }
    }
  }
  throw new Error('图片过大，请换一张')
}
