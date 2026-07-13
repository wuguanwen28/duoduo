/**
 * 触发器-动作统一绑定 —— 手势与快捷键合并为单一数组。
 *
 * - 鼠标手势（前4条固定）：trigger 为 MouseTrigger 枚举，仅可改动作。
 * - 键盘快捷键（动态新增）：trigger 为按键串，可改动作 / 作用域 / 删除。
 * 两者动作统一引用 PET_ACTIONS，由主窗分发时查表执行。
 *
 * 持久化由 appSettings.ts 统一管理（~/.duoduo/setting.json），通过 Tauri 事件
 * 在设置窗与主窗之间同步。默认绑定见 ./defaults.ts。
 */
import { ref } from 'vue'
import type { SpeakPhrase } from './speakPhrases'
import { DEFAULT_TRIGGER_BINDINGS } from './defaults'
import { emitForCat, listenForCat } from './catContext'

/** 触发类型。 */
export type TriggerKind = 'mouse' | 'key'

/** 鼠标手势的固定触发方式枚举。 */
export type MouseTrigger =
  'leftClick' | 'doubleClick' | 'rightClick' | 'longPress'

/** 单条触发器-动作绑定。 */
export interface TriggerBinding {
  /** 稳定标识，用于持久化 / 分发 / 冲突标记 / v-for key。 */
  id: string
  /** 触发类型：mouse=鼠标手势（前4条固定），key=键盘快捷键（动态新增）。 */
  kind: TriggerKind
  /**
   * 触发方式：
   * - kind=mouse：MouseTrigger 枚举值（只读）。
   * - kind=key：录制出的按键串 "Alt+Z"；空串=未绑定。
   */
  trigger: string
  /** 触发动作，引用 PET_ACTIONS 的 key。 */
  actionId: string
  /** 仅 kind=key 有效：是否系统层全局注册。mouse 不使用此字段。 */
  isGlobal?: boolean
  /**
   * 仅 actionId 为 speak / pokeAndSpeak 时有意义：该触发器的独立说话短语池。
   * 缺省时说话为空（不出气泡）。
   */
  phrases?: SpeakPhrase[]
}

/** 设置窗改动保存后广播；主窗收到后重新应用全部绑定。 */
export const TRIGGER_BINDINGS_CHANGED_EVENT = 'trigger-bindings-changed'

/** 主窗应用后回传注册结果；设置窗据此把被占用的全局键标红。 */
export const TRIGGER_BINDINGS_RESULT_EVENT = 'trigger-bindings-result'

/** 主窗回传的注册结果载荷。 */
export interface TriggerResult {
  /** 注册失败（疑似被其他程序占用）的全局快捷键 id 列表。 */
  failedIds: string[]
}

/** 当前生效的触发器绑定；初始为默认预置，由 appSettings 启动时填充。 */
export const triggerBindings = ref<TriggerBinding[]>(
  DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e })),
)

/** 从持久化数据填充；无配置或损坏时回退默认预置。 */
export function hydrateTriggerBindings(entries: any): void {
  if (Array.isArray(entries) && entries.length > 0) {
    triggerBindings.value = entries.map((e: any) => ({ ...e }))
  } else {
    triggerBindings.value = DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }))
  }
}

/** 返回当前生效绑定的副本（供设置页初始化编辑行 / 主窗热重载后重载）。 */
export function loadTriggerBindings(): TriggerBinding[] {
  return triggerBindings.value.map((e) => ({ ...e }))
}

/** 保存绑定列表：更新内存 ref 并广播（持久化由 appSettings 监听本事件后统一写盘）。 */
export function saveTriggerBindings(entries: TriggerBinding[]): void {
  triggerBindings.value = entries.map((e) => ({ ...e }))
  emitForCat(TRIGGER_BINDINGS_CHANGED_EVENT, triggerBindings.value)
}

/**
 * 跨窗口同步：只应用属于本窗口当前猫的变更（catId 过滤）。
 * 主窗据此刷新触发器绑定并重新应用（Pet.vue 另有 listen 触发 applyTriggerBindings）。
 */
listenForCat<TriggerBinding[]>(TRIGGER_BINDINGS_CHANGED_EVENT, (data) => {
  if (Array.isArray(data)) {
    triggerBindings.value = data.map((e) => ({ ...e }))
  }
})

// ── 按键序列化（从原 useShortcuts 迁入） ────────────────────────

/**
 * 把键盘事件序列化为内部按键串（如 `"Ctrl+Shift+A"`）。
 * 纯修饰键、Escape 返回 `null`（调用方据此忽略或取消录制）。
 */
export function serializeKeyEvent(e: KeyboardEvent): string | null {
  const { ctrlKey, shiftKey, altKey, metaKey, key } = e
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  if (key === 'Escape') return null
  const parts: string[] = []
  if (ctrlKey) parts.push('Ctrl')
  if (shiftKey) parts.push('Shift')
  if (altKey) parts.push('Alt')
  if (metaKey) parts.push('Meta')
  let mainKey = key
  if (mainKey.length === 1) mainKey = mainKey.toUpperCase()
  else if (mainKey === ' ') mainKey = 'Space'
  parts.push(mainKey)
  return parts.join('+')
}

/** 判断某次 keydown 是否命中给定按键串（用于应用内快捷键匹配）。 */
export function matchesKey(e: KeyboardEvent, key: string): boolean {
  if (!key) return false
  return serializeKeyEvent(e) === key
}

/** 内部修饰键 → Tauri accelerator 修饰键名。 */
const ACCEL_MODIFIERS: Record<string, string> = {
  Ctrl: 'Control',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Super',
}

/** 个别主键名到 Tauri accelerator 的映射（其余字母/数字/功能键直接透传）。 */
const ACCEL_KEYS: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

/**
 * 把内部按键串转成 global-shortcut 接受的 accelerator
 * （如 `"Ctrl+Shift+A"` → `"Control+Shift+A"`）。空串返回空串。
 */
export function toAccelerator(key: string): string {
  if (!key) return ''
  const parts = key.split('+')
  const out: string[] = []
  parts.forEach((p, i) => {
    if (i < parts.length - 1) {
      out.push(ACCEL_MODIFIERS[p] ?? p)
    } else {
      out.push(ACCEL_KEYS[p] ?? p)
    }
  })
  return out.join('+')
}

/** 把按键串格式化为更友好的显示文本（`Meta` 显示为 `Win`）。 */
export function formatKey(key: string): string {
  return key
    .split('+')
    .map((k) => (k === 'Meta' ? 'Win' : k))
    .join(' + ')
}
