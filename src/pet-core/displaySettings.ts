/**
 * 显示设置 —— 大小、透明度、窗口层级、点击穿透。
 *
 * 持久化由 appSettings.ts 统一管理（~/.duoduo/setting.json）。
 * 【单向同步模式】：只有设置窗会调用 `saveAndBroadcast()` 广播；
 * 主窗只监听事件更新本地状态，永远不广播，避免死循环。
 * 默认值见 ./defaults.ts。
 */
import { ref } from 'vue'
import { listen, emit } from '@tauri-apps/api/event'
import { DISPLAY_DEFAULTS } from './defaults'
import { currentCatId } from './catContext'

/** 跨窗口同步事件名。 */
export const DISPLAY_SETTINGS_CHANGED_EVENT = 'display-settings-changed'

/**
 * 显示设置结构（size / opacity / alwaysOnTop / passthrough + 跟随开关 + 头部校准偏移）。
 * 六个字段 UI 同在显示页、存储归 display、跨窗口同步统一走 display-settings-changed 广播。
 */
export interface DisplaySettings {
  size: number
  opacity: number
  alwaysOnTop: boolean
  passthrough: boolean
  /** 跟随光标开关。 */
  follow: boolean
  /** 头部校准偏移（占精灵直径比例；0,0=图像中心）。 */
  headOffset: { x: number; y: number }
}

/** 持久化形态（与 DisplaySettings 同构，供 appSettings 使用）。 */
export type DisplayStored = DisplaySettings

/**
 * 广播 payload 在 DisplaySettings 基础上多带一个源窗口标识，
 * 用来在 listen 里识别并过滤"自己 emit、自己收到"的回声。
 */
interface DisplaySettingsPayload extends DisplaySettings {
  /** 发出该事件的会话实例 ID。 */
  _src: string
  /** 该变更所属的猫 id，接收方按本窗口 currentCatId 过滤。 */
  catId: string
}

/** 本次会话（本窗口本次加载）的唯一标识，模块加载时生成一次，永不变。 */
const SOURCE_ID = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2)}`

/** 广播节流间隔（毫秒）：滑块 ~60Hz 抖动太多，合并到 ~20Hz 即可。 */
const BROADCAST_THROTTLE_MS = 50

/** 当前显示设置；初始为默认值，由 appSettings 启动时填充。 */
export const size = ref(DISPLAY_DEFAULTS.size)
export const opacity = ref(DISPLAY_DEFAULTS.opacity)
export const alwaysOnTop = ref(DISPLAY_DEFAULTS.alwaysOnTop)
export const passthrough = ref(DISPLAY_DEFAULTS.passthrough)
/** 跟随光标开关（原在 appSettings，现随 display 统一管理）。 */
export const follow = ref(DISPLAY_DEFAULTS.follow)
/** 头部校准偏移（原在 appSettings，现随 display 统一管理）。 */
export const headOffset = ref<{ x: number; y: number }>({
  ...DISPLAY_DEFAULTS.headOffset,
})

/** 从持久化数据填充（appSettings.loadAppSettings 调用）。 */
export function hydrateDisplay(data: Partial<DisplayStored> | undefined): void {
  size.value =
    typeof data?.size === 'number' ? data.size : DISPLAY_DEFAULTS.size
  opacity.value =
    typeof data?.opacity === 'number' ? data.opacity : DISPLAY_DEFAULTS.opacity
  alwaysOnTop.value =
    typeof data?.alwaysOnTop === 'boolean'
      ? data.alwaysOnTop
      : DISPLAY_DEFAULTS.alwaysOnTop
  passthrough.value =
    typeof data?.passthrough === 'boolean'
      ? data.passthrough
      : DISPLAY_DEFAULTS.passthrough
  follow.value =
    typeof data?.follow === 'boolean' ? data.follow : DISPLAY_DEFAULTS.follow
  headOffset.value =
    data?.headOffset &&
    typeof data.headOffset.x === 'number' &&
    typeof data.headOffset.y === 'number'
      ? { x: data.headOffset.x, y: data.headOffset.y }
      : { ...DISPLAY_DEFAULTS.headOffset }
}

/** 将当前显示设置序列化为对象。 */
function snapshot(): DisplaySettings {
  return {
    size: size.value,
    opacity: opacity.value,
    alwaysOnTop: alwaysOnTop.value,
    passthrough: passthrough.value,
    follow: follow.value,
    headOffset: { x: headOffset.value.x, y: headOffset.value.y },
  }
}

/** 浮点数比较：用 epsilon 避免精度问题导致的死循环。 */
function areFloatsEqual(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) < epsilon
}

/** 广播节流计时器。 */
let broadcastTimer: number | undefined

/**
 * 【仅设置窗调用】只广播，不持久化（节流版）。
 * 用于滑块拖动时实时同步给主窗。
 */
export function broadcast(): void {
  if (broadcastTimer !== undefined) return
  broadcastTimer = window.setTimeout(() => {
    broadcastTimer = undefined
    const s = snapshot()
    const payload: DisplaySettingsPayload = {
      ...s,
      _src: SOURCE_ID,
      catId: currentCatId.value,
    }
    emit(DISPLAY_SETTINGS_CHANGED_EVENT, payload).catch(() => {})
  }, BROADCAST_THROTTLE_MS)
}

/**
 * 【仅设置窗调用】广播一次（松手等最终变更）。
 * 持久化由 appSettings 监听本事件后统一写盘。
 * 主窗不要调用这个函数！
 */
export function saveAndBroadcast(): void {
  // 清除节流计时器，确保最终值一定会广播
  if (broadcastTimer !== undefined) {
    clearTimeout(broadcastTimer)
    broadcastTimer = undefined
  }
  const payload: DisplaySettingsPayload = {
    ...snapshot(),
    _src: SOURCE_ID,
    catId: currentCatId.value,
  }
  emit(DISPLAY_SETTINGS_CHANGED_EVENT, payload).catch(() => {})
}

/**
 * 跨窗口同步：监听其他窗口广播的变更事件，更新本地响应式数据。
 * listen() 会注册全局监听器，模块只需加载一次即可生效。
 * `_src === SOURCE_ID` 表示是本窗口自己 emit 的回声，必须忽略。
 */
listen<DisplaySettingsPayload>(DISPLAY_SETTINGS_CHANGED_EVENT, (event) => {
  const p = event.payload
  if (p._src === SOURCE_ID) return
  // 只应用属于本窗口当前猫的变更，避免多宠物窗互相污染。
  if (p.catId !== currentCatId.value) return
  if (!areFloatsEqual(size.value, p.size)) size.value = p.size
  if (!areFloatsEqual(opacity.value, p.opacity)) opacity.value = p.opacity
  if (alwaysOnTop.value !== p.alwaysOnTop) alwaysOnTop.value = p.alwaysOnTop
  if (passthrough.value !== p.passthrough) passthrough.value = p.passthrough
  if (follow.value !== p.follow) follow.value = p.follow
  if (
    headOffset.value.x !== p.headOffset.x ||
    headOffset.value.y !== p.headOffset.y
  ) {
    headOffset.value = { x: p.headOffset.x, y: p.headOffset.y }
  }
})
