/**
 * 外置资源仓库 —— 加载并解析 exe 同级 `resources/` 下的素材与 manifest.json。
 *
 * 取代旧的 `actions/frames.ts`（构建期 import.meta.glob 打包）。流程：
 *   1. 调后端 `pet_scan_resources` 拿到 { manifest, frames(绝对路径), error }；
 *   2. 用 convertFileSrc 把绝对路径转成 asset URL；
 *   3. 把 manifest 解析成强类型模型（动作 / 行为 / 跟随）；
 *   4. 预加载图片，避免首帧磁盘 IO 卡顿。
 *
 * 模型加载成功后存于模块级 `model`，其余模块通过下方 getter 读取。加载必须在
 * 状态机启动前完成（由 App.vue 控制：就绪才挂载 <Pet>，失败显示缺资源引导）。
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type { SpeakPhrase } from './speakPhrases'
import { currentCatId } from './catContext'

/** 一个动作（=manifest 的一个 action）解析后的运行时形态。 */
export interface ResolvedClip {
  /** 动作名（manifest.actions 的键）。 */
  name: string
  /** 帧 URL 数组，已转 asset URL、已按 reverse 处理好方向。 */
  frames: string[]
  /** 播放帧率。 */
  fps: number
  /** 是否来回播（正放 + 反放，去重端点）；展开在播放层做。 */
  yoyo: boolean
  /** 视觉水平偏移（占精灵直径比例）。 */
  offsetX: number
  /** 视觉垂直偏移（占精灵直径比例）。 */
  offsetY: number
  /** 视觉缩放系数。 */
  scale: number
}

/** 随机插播项：引用一个动作名 + 相对权重。 */
export interface TwitchItem {
  /** 被引用的动作名（沿用 `clip` 字段名以兼容旧的播放器接口）。 */
  clip: string
  /** 加权随机的相对权重，省略默认 1。 */
  weight?: number
  /**
   * 仅 clip === "__speak" 时有意义：该说话入口的独立短语池。
   * 缺省时说话动作为空（不出气泡）；用户在设置里编辑后写入 manifest。
   */
  phrases?: SpeakPhrase[]
}

/** 行为的循环段：基底动作 + 随机插播 + 插播间隔。 */
export interface BehaviorLoop {
  /** 基底循环动作名。 */
  base: string
  /** 随机插播列表（可空）。 */
  random: TwitchItem[]
  /** 两次插播之间的随机间隔 [min,max]（毫秒）。 */
  delay: [number, number]
}

/** 一个自治行为（=manifest 的一个 behavior）。 */
export interface Behavior {
  /** 显示名（可中文），仅界面展示，可空。 */
  label?: string
  /** 进入时播放一次的动作名（可选，如 sleep 的 lieDown）。 */
  enter?: string
  /** 环境循环。 */
  loop: BehaviorLoop
  /** 离开时播放一次的动作名（可选，如 sleep 的 wakeUp）。 */
  exit?: string
  /** 加权轮换被选中的相对权重。 */
  weight: number
  /** 本行为持续多久后触发轮换，随机区间 [min,max] 毫秒。 */
  duration: [number, number]
  /** 鼠标移动能否抢占进 follow，默认 false。 */
  interruptible?: boolean
}

/** 跟随光标的配置 —— 靠线性公式按角度取帧。 */
export interface FollowConfig {
  /** 方向帧 URL 数组（已转 asset URL）。 */
  frames: string[]
  /** 帧号递增方向是否为顺时针。 */
  clockwise: boolean
  /** 第 0 帧的朝向（时钟约定：0=上, 90=右, 180=下, 270=左）。 */
  startAngle: number
}

/** 解析后的完整资源模型。 */
interface ResourceModel {
  /** 资源根目录绝对路径（排错用）。 */
  root: string
  /** 动作名 → 解析后的动作。 */
  actions: Record<string, ResolvedClip>
  /** 行为名 → 解析后的行为。 */
  behaviors: Record<string, Behavior>
  /** 默认/兜底行为名：启动、follow 回落、触发动作的归属都用它。 */
  defaultBehavior: string
  /** 跟随配置；无 follow 素材时为 null（猫不跟随光标）。 */
  follow: FollowConfig | null
  /** 帧 URL → 所属动作名，供视觉变换反查。 */
  frameToAction: Map<string, string>
}

/** 后端 `pet_scan_resources` 的返回结构。 */
interface ScanResult {
  root: string
  manifest: any
  frames: Record<string, string[]>
  error: string | null
}

/** 加载结果：ok 为 false 时 error 描述原因，供前端显示缺资源引导。 */
export interface LoadResult {
  ok: boolean
  error?: string
}

let model: ResourceModel | null = null
/** 最近一次扫描得到的资源根目录（即便加载失败也保留，供引导卡片提示路径）。 */
let lastRoot = ''

/** 读取已加载的资源模型；未加载时抛错（调用方应保证先 loadResources 成功）。 */
export function getModel(): ResourceModel {
  if (!model) throw new Error('资源尚未加载，请先调用 loadResources()')
  return model
}

/** 资源根目录绝对路径；扫描后即可用（含加载失败的情况），未扫描时为空串。 */
export function getResourceRoot(): string {
  return lastRoot
}

/** 资源是否已成功加载。 */
export function isLoaded(): boolean {
  return model !== null
}

/** 默认/兜底行为名。 */
export function getDefaultBehavior(): string {
  return getModel().defaultBehavior
}

/** 把任意值规整成 [number,number] 数对，非法时回退默认值。 */
function normPair(v: any, fallback: [number, number]): [number, number] {
  if (
    Array.isArray(v) &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number'
  ) {
    return [v[0], v[1]]
  }
  return fallback
}

/** 预加载一批图片（不阻塞，仅触发浏览器缓存预热）。 */
function preload(urls: string[]) {
  for (const u of urls) {
    const img = new Image()
    img.src = u
  }
}

/**
 * 加载并解析外置资源。成功时填充模块级 `model` 并返回 { ok:true }；
 * 任何一步失败（扫描出错、缺 manifest、缺 idle 行为）返回 { ok:false, error }。
 */
export async function loadResources(): Promise<LoadResult> {
  let scan: ScanResult
  try {
    // 按本窗口当前猫扫描其资源（loadAppSettings 已在 boot 前设好 currentCatId）。
    scan = await invoke<ScanResult>('pet_scan_resources', {
      catId: currentCatId.value,
    })
  } catch (e) {
    return { ok: false, error: `调用 pet_scan_resources 失败：${e}` }
  }
  lastRoot = scan.root
  if (scan.error) return { ok: false, error: scan.error }

  const manifest = scan.manifest ?? {}

  // 1) 绝对路径 → asset URL（按动作名分组，含特殊键 "follow"）。
  const urls: Record<string, string[]> = {}
  for (const [key, paths] of Object.entries(scan.frames)) {
    urls[key] = paths.map((p) => convertFileSrc(p))
  }

  // 2) 解析动作库。
  const actions: Record<string, ResolvedClip> = {}
  const frameToAction = new Map<string, string>()
  const rawActions = (manifest.actions ?? {}) as Record<string, any>
  for (const [name, def] of Object.entries(rawActions)) {
    let frames = urls[name] ?? []
    if (def?.reverse) frames = [...frames].reverse()
    if (frames.length === 0) continue // 没有帧的动作直接跳过
    actions[name] = {
      name,
      frames,
      fps: typeof def?.fps === 'number' ? def.fps : 24,
      yoyo: !!def?.yoyo,
      offsetX: typeof def?.offsetX === 'number' ? def.offsetX : 0,
      offsetY: typeof def?.offsetY === 'number' ? def.offsetY : 0,
      scale: typeof def?.scale === 'number' ? def.scale : 1,
    }
    for (const u of frames)
      if (!frameToAction.has(u)) frameToAction.set(u, name)
  }

  // 3) 解析跟随配置（无 follow 素材则 null）。
  let follow: FollowConfig | null = null
  const f = manifest.follow
  if (f && (urls['follow']?.length ?? 0) > 0) {
    follow = {
      frames: urls['follow'],
      clockwise: f.clockwise !== false,
      startAngle: typeof f.startAngle === 'number' ? f.startAngle : 0,
    }
  }

  // 4) 解析行为库。只接受 base 指向有效动作的行为；并剔除 random 中无效引用。
  const behaviors: Record<string, Behavior> = {}
  const rawBeh = (manifest.behaviors ?? {}) as Record<string, any>
  for (const [name, b] of Object.entries(rawBeh)) {
    if (!b?.base || !actions[b.base]) continue // 基底动作缺失：跳过该行为
    const random: TwitchItem[] = Array.isArray(b.random)
      ? b.random
          .map((r: any) => ({
            clip: r?.action,
            weight: r?.weight,
            // __speak 的独立短语池原样带出（数组校验 + 基础规整）。
            phrases:
              Array.isArray(r?.phrases) && r.clip === '__speak'
                ? r.phrases
                    .filter((p: any) => p && typeof p.text === 'string')
                    .map((p: any) => ({
                      text: String(p.text).trim(),
                      weight: Math.max(0, Number(p.weight) || 0),
                    }))
                : undefined,
          }))
          // 保留两类：资源动作（actions 里登记）或内置动作（`__` 前缀，如 `__speak`）。
          // 内置动作由播放层 useBehavior 转交 Pet.vue 执行，不依赖资源帧。
          .filter(
            (r: TwitchItem) =>
              r.clip && (actions[r.clip] || r.clip.startsWith('__')),
          )
      : []
    behaviors[name] = {
      label: typeof b.name === 'string' ? b.name : undefined,
      enter: b.enter && actions[b.enter] ? b.enter : undefined,
      exit: b.exit && actions[b.exit] ? b.exit : undefined,
      weight: typeof b.weight === 'number' ? b.weight : 1,
      duration: normPair(b.duration, [15000, 40000]),
      interruptible: !!b.interruptible,
      loop: { base: b.base, random, delay: normPair(b.delay, [3000, 8000]) },
    }
  }

  const behaviorNames = Object.keys(behaviors)
  // 既无有效行为、也无跟随素材，才算缺资源；只要有 follow 就放行（纯跟随模式）。
  if (behaviorNames.length === 0 && !follow) {
    return {
      ok: false,
      error:
        'manifest.json 既没有有效行为（每个行为需 base 指向存在的动作），也没有 follow 跟随素材',
    }
  }

  // 默认/兜底行为：取 manifest.defaultBehavior，无效则回退到 idle 或第一个行为；
  // 无任何行为时为空串（纯跟随模式，状态机不再轮换行为）。
  let defaultBehavior =
    typeof manifest.defaultBehavior === 'string' ? manifest.defaultBehavior : ''
  if (!behaviors[defaultBehavior]) {
    defaultBehavior =
      behaviorNames.length === 0
        ? ''
        : behaviors['idle']
          ? 'idle'
          : behaviorNames[0]
  }

  // 5) 预加载所有帧。
  preload([
    ...Object.values(actions).flatMap((a) => a.frames),
    ...(follow?.frames ?? []),
  ])

  model = {
    root: scan.root,
    actions,
    behaviors,
    follow,
    frameToAction,
    defaultBehavior,
  }
  return { ok: true }
}

/** 全部已解析动作名（manifest.actions 的键），供「随机动作」等枚举使用。 */
export function getActionNames(): string[] {
  try {
    return Object.keys(getModel().actions)
  } catch {
    return []
  }
}

/** 全部已解析行为名（manifest.behaviors 的键），供「随机行为」等枚举使用。 */
export function getBehaviorNames(): string[] {
  try {
    return Object.keys(getModel().behaviors)
  } catch {
    return []
  }
}
