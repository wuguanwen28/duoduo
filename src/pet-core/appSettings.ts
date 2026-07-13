/**
 * 应用配置中枢 —— 多猫统一管理 ~/.duoduo/ 下的配置文件。
 *
 * 存储：
 * - 全局 setting.json：activeCatId + cats{id → 身份档案(name/性别/生日/标签/简介)}
 * - 每猫 cats/<id>.json：行为配置(display/menu/说话/触发器/windowPos/resourceRoot)
 * - 头像 avatars/<id>.png（文件存在与否 = 头像有无的唯一真源）
 *
 * currentCatId 是当前编辑/加载的猫。设置页切换猫用 switchCat；宠物窗加载固定 catId。
 * 各子模块 saveXxx 仍 emit 跨窗口事件；本模块监听后 scheduleSave 写当前猫文件。
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { ref } from 'vue'

import {
  basicSettings,
  hydrateBasic,
  BASIC_SETTINGS_CHANGED_EVENT,
} from './basicSettings'
import {
  size,
  opacity,
  alwaysOnTop,
  passthrough,
  follow,
  headOffset,
  hydrateDisplay,
  DISPLAY_SETTINGS_CHANGED_EVENT,
} from './displaySettings'
import {
  menuSettings,
  hydrateMenu,
  defaultMenu,
  MENU_SETTINGS_CHANGED_EVENT,
} from './menuSettings'
import {
  speakPhrases,
  defaultSpeakPhrases,
  hydrateSpeakPhrases,
  hydrateDefaultSpeakPhrases,
  SPEAK_PHRASES_CHANGED_EVENT,
  SPEAK_PHRASES_DEFAULT_CHANGED_EVENT,
} from './speakPhrases'
import {
  triggerBindings,
  hydrateTriggerBindings,
  TRIGGER_BINDINGS_CHANGED_EVENT,
} from './triggerBindings'
import type { MenuItemConfig } from './menuSettings'
import type { SpeakPhrase } from './speakPhrases'
import type { TriggerBinding } from './triggerBindings'
import {
  BASIC_DEFAULTS,
  DISPLAY_DEFAULTS,
  DEFAULT_SPEAK_PHRASES,
  DEFAULT_TRIGGER_BINDINGS,
} from './defaults'
import { currentCatId, emitForCat } from './catContext'

// currentCatId 定义在 catContext.ts（供各子模块无循环依赖地引用）；此处 re-export
// 保持对外 API 不变（其他文件仍从 appSettings 导入 currentCatId）。
export { currentCatId }

// follow / headOffset 的 ref 现由 displaySettings 持有（display 统一管理广播），
// 此处 re-export 保持消费方（Pet.vue 等）import 路径不变。
export { follow, headOffset }

/** 触发某只猫的宠物窗进入头部校准模式（设置窗「校准猫头」按钮）。 */
export const START_CALIBRATE_EVENT = 'start-calibrate'

// ── 类型（镜像 Rust 端） ──────────────────────────────────────

export interface DisplayStored {
  size: number
  opacity: number
  alwaysOnTop: boolean
  passthrough: boolean
  follow: boolean
  headOffset: { x: number; y: number }
}
/** 单猫**行为配置**（cats/<id>.json）。身份信息（name/性别等）已上移到 CatMeta。 */
export interface CatSettings {
  display: DisplayStored
  menu: MenuItemConfig[]
  speakPhrases: SpeakPhrase[]
  speakPhrasesDefault: SpeakPhrase[]
  triggerBindings: { entries: TriggerBinding[] }
  /** 宠物窗上次位置（物理像素）；null=还没记录过，创建时算默认错开位置。 */
  windowPos?: { x: number; y: number } | null
  /** 该猫素材目录（绝对路径）；null=未设置。服务端拥有字段，snapshot 不回写，只读展示。 */
  resourceRoot?: string | null
}
/** 猫**身份档案**（存于全局 setting.json 的 cats）：名字 + 人设。头像有无由文件决定，不在此。 */
export interface CatMeta {
  name: string
  birthday: string
  gender: 'boy' | 'girl' | 'unknown'
  tags: string[]
  description: string
}
/** 更新气泡关闭计次：同一版本最多自动提醒 2 次（与 Rust settings.rs 的 UpdateDismissState 对齐）。 */
export interface UpdateDismissState {
  version: string
  count: number
}
export interface GlobalSettings {
  version: number
  activeCatId: string
  cats: Record<string, CatMeta>
  updateDismiss: UpdateDismissState | null
  /** 启动时自动上班的猫 id 列表（基础设置卡片勾选）；旧配置可能为空，启动回退 default。 */
  autoShowCats: string[]
}
export interface CatEntry {
  id: string
  name: string
  birthday: string
  gender: 'boy' | 'girl' | 'unknown'
  tags: string[]
  description: string
  /** 头像绝对路径；空串表示无自定义头像。 */
  avatarUrl: string
}

// ── 当前状态 ─────────────────────────────────────────────────

/** 全局配置内存镜像。 */
export const globalSettings = ref<GlobalSettings | null>(null)
/** 当前猫头像 asset URL；空串表示无自定义头像。 */
export const avatarUrl = ref('')
/** 当前猫宠物窗位置（物理像素）；仅宠物窗写、随 saveNow 持久化到 cats/<id>.json。 */
export const windowPos = ref<{ x: number; y: number } | null>(null)
/**
 * 当前猫的素材目录（绝对路径）；空串=未设置或用内置默认。
 * **仅供 UI 展示**：resourceRoot 是服务端拥有字段，snapshotCat 不回写它，
 * 唯一写者是 changeResourceRoot → pet_set_resource_root。
 */
export const resourceRoot = ref('')

/**
 * 头像破缓存令牌（单一真源）。
 *
 * 头像文件路径按 id 固定（avatars/<id>.png），换头像是覆盖写、路径不变，WebView 会
 * 命中同名图片的旧缓存。所有派生头像 URL 都必须经 {@link avatarAssetUrl} 附加此令牌，
 * 令牌只在存/删头像时 bump（见 saveAvatar/resetAvatar），保证全窗口所有头像一致刷新，
 * 又不会每次渲染都变导致闪烁。
 */
export const avatarCacheToken = ref(Date.now())

/**
 * 把后端返回的头像绝对路径转成带破缓存令牌的 asset URL。
 * @param path pet_avatar_url / CatEntry.avatarUrl 返回的绝对路径；空串表示无头像，返回空串。
 */
export function avatarAssetUrl(path: string): string {
  return path ? `${convertFileSrc(path)}?t=${avatarCacheToken.value}` : ''
}

// ── 加载 ─────────────────────────────────────────────────────

/**
 * 加载配置并填充各子模块 ref。
 * @param catId 指定猫 id；省略则用全局 activeCatId（设置页用）。
 */
export async function loadAppSettings(catId?: string): Promise<void> {
  const g = await invoke<GlobalSettings>('pet_load_global')
  globalSettings.value = g
  const id = catId ?? g.activeCatId ?? 'default'
  currentCatId.value = id
  const cat = await invoke<CatSettings>('pet_load_cat', { catId: id })
  // 身份档案（basic）现存于全局 cats[id]，不再随 cat 文件加载。
  hydrateBasic(g.cats[id])
  hydrateDisplay(cat.display)
  hydrateMenu(cat.menu)
  hydrateSpeakPhrases(cat.speakPhrases)
  hydrateDefaultSpeakPhrases(cat.speakPhrasesDefault)
  hydrateTriggerBindings(cat.triggerBindings?.entries)
  // follow / headOffset 已由 hydrateDisplay(cat.display) 一并填充。
  windowPos.value = cat.windowPos ?? null
  resourceRoot.value = cat.resourceRoot ?? ''
  // 头像：经 avatarAssetUrl 统一附加破缓存令牌（与卡片/选猫弹窗一致）。
  const p = await invoke<string>('pet_avatar_url', { catId: id })
  avatarUrl.value = avatarAssetUrl(p)
  // 通知设置页：当前猫配置已加载完成（所有 ref 已 hydrate）。各设置页据此重载按猫
  // 的本地状态（资源页 manifest、显示页触发器行/动作下拉），避免切猫后仍显示上一只猫。
  // 用事件而非 watch(currentCatId)：loadAppSettings 先设 currentCatId、后 hydrate 各 ref，
  // watch 会过早触发读到未 hydrate 的旧数据；事件在全部 hydrate 完成后发，时序正确。
  emit('cat-loaded', id).catch(() => {})
}

/** 切换当前编辑猫（设置页选猫用）。 */
export async function switchCat(catId: string): Promise<void> {
  await loadAppSettings(catId)
}

// ── 保存 ─────────────────────────────────────────────────────

/** 收集当前各子模块 ref 组装单猫**行为配置**（身份档案另存全局，见 syncIdentityToGlobal）。 */
function snapshotCat(): CatSettings {
  return {
    display: {
      size: size.value,
      opacity: opacity.value,
      alwaysOnTop: alwaysOnTop.value,
      passthrough: passthrough.value,
      follow: follow.value,
      headOffset: { x: headOffset.value.x, y: headOffset.value.y },
    },
    menu: menuSettings.value,
    speakPhrases: speakPhrases.value,
    speakPhrasesDefault: defaultSpeakPhrases.value,
    triggerBindings: { entries: triggerBindings.value },
    windowPos: windowPos.value,
  }
}

/** 当前身份档案（basicSettings ref）快照，用于写入全局 cats[id]。 */
function snapshotIdentity(): CatMeta {
  return {
    name: basicSettings.value.name,
    birthday: basicSettings.value.birthday,
    gender: basicSettings.value.gender,
    tags: [...basicSettings.value.tags],
    description: basicSettings.value.description,
  }
}

/** 防抖计时器。 */
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** 防抖间隔：合并短时间内的多次变更。 */
const SAVE_DEBOUNCE_MS = 300

/** 防抖保存当前猫配置。 */
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void saveNow()
  }, SAVE_DEBOUNCE_MS)
}

/** 立即保存当前猫的行为配置 + 身份档案（写入全局 cats[id]）。 */
export async function saveNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  const id = currentCatId.value
  try {
    await invoke('pet_save_cat', { catId: id, cat: snapshotCat() })
  } catch (e) {
    console.error('保存猫配置失败', e)
  }
  // 同步身份档案到全局 cats[id]：身份信息现只存全局，故每次保存都要写回。
  if (globalSettings.value) {
    const g = globalSettings.value
    const next = snapshotIdentity()
    const meta = g.cats[id]
    // 仅在实际变化时写盘，避免行为配置变更也触发全局文件重写。
    if (!meta || JSON.stringify(meta) !== JSON.stringify(next)) {
      g.cats[id] = next
      try {
        await invoke('pet_save_global', { global: g })
      } catch (e) {
        console.error('保存全局配置失败', e)
      }
    }
  }
}

// ── 增删猫 ───────────────────────────────────────────────────

/**
 * 单猫**行为配置**默认值（display / menu / 说话 / 触发器 / follow / 头部校准），取自 defaults.ts。
 * 每只猫都一样，写入 cats/<id>.json。身份人设不在此——见 CatMeta（存全局）。
 */
function defaultCatSettings(): CatSettings {
  return {
    display: {
      ...DISPLAY_DEFAULTS,
      headOffset: { ...DISPLAY_DEFAULTS.headOffset },
    },
    menu: defaultMenu(),
    speakPhrases: DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p })),
    speakPhrasesDefault: DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p })),
    triggerBindings: {
      entries: DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e })),
    },
  }
}

/** 初始默认猫「多多」的身份档案（全新装机 bootstrap 用）。 */
function defaultIdentity(): CatMeta {
  return {
    name: BASIC_DEFAULTS.name,
    birthday: BASIC_DEFAULTS.birthday,
    gender: BASIC_DEFAULTS.gender,
    tags: [...BASIC_DEFAULTS.tags],
    description: BASIC_DEFAULTS.description,
  }
}

/** 空白身份（用户新增猫用）：名字/描述留空，性别未知。名字由用户在弹窗必填。 */
function blankIdentity(): CatMeta {
  return {
    name: '',
    birthday: '',
    gender: 'unknown',
    tags: [],
    description: '',
  }
}

/**
 * 首次启动引导：若 setting.json 尚不存在（全新安装 / 用户删了 .duoduo），
 * 用前端 defaults.ts（默认值唯一真源）显式写出完整的 default 猫 + 全局元数据。
 *
 * 不依赖 Rust 端的 CatSettings::default（那是空骨架）+ hydrate 兜底的隐式时序，
 * 保证磁盘上一开始就是一份完整、可读的配置。
 */
export async function bootstrapIfEmpty(): Promise<void> {
  let exists = false
  try {
    exists = await invoke<boolean>('pet_settings_exists')
  } catch {
    // 命令不可用时保守认为已存在，不覆盖用户数据。
    return
  }
  if (exists) return

  const id = 'default'
  await invoke('pet_save_cat', { catId: id, cat: defaultCatSettings() })
  const g: GlobalSettings = {
    version: 1,
    activeCatId: id,
    cats: { [id]: defaultIdentity() },
    updateDismiss: null,
    autoShowCats: ['default'],
  }
  await invoke('pet_save_global', { global: g })
  globalSettings.value = g
  // 给默认猫写入内置默认头像（icon.png），开箱即带头像。已存在则不覆盖。
  await invoke('pet_ensure_default_avatar', { catId: id }).catch(() => {})
}

/** 新增一只猫（出厂默认配置）并切换到它。返回新猫 id。
 *  id 不带 `cat-` 前缀（窗口 label 会另加 `cat-` 前缀，避免双前缀）。 */
export async function addCat(): Promise<string> {
  const id = `c${Date.now().toString(36)}`
  // 新增猫用空白身份（名字待用户在弹窗必填），行为/交互取默认值。
  await invoke('pet_save_cat', { catId: id, cat: defaultCatSettings() })
  const g =
    globalSettings.value ?? (await invoke<GlobalSettings>('pet_load_global'))
  g.cats[id] = blankIdentity()
  await invoke('pet_save_global', { global: g })
  globalSettings.value = g
  await switchCat(id)
  return id
}

/** 删除一只猫：先关它的宠物窗（避免僵尸窗把文件写回），再删文件+元数据；
 *  若删的是当前编辑猫则切到剩余第一只。 */
export async function deleteCat(id: string): Promise<void> {
  // 先关窗：宠物窗销毁后不再 scheduleSave，避免删文件后又被写回。
  await invoke('pet_close_cat_window', { catId: id }).catch(() => {})
  await invoke('pet_delete_cat', { catId: id })
  globalSettings.value = await invoke<GlobalSettings>('pet_load_global')
  // 清理 autoShowCats 里残留的已删猫 id，避免启动时 show 不存在的猫。
  if (globalSettings.value?.autoShowCats?.includes(id)) {
    await setAutoShowCats(
      globalSettings.value.autoShowCats.filter((x) => x !== id),
    )
  }
  if (currentCatId.value === id) {
    const next = Object.keys(globalSettings.value?.cats ?? {})[0] ?? 'default'
    await switchCat(next)
  }
}

/** 列出所有猫（元数据 + 头像 URL），供卡片列表/选猫弹窗。 */
export async function listCats(): Promise<CatEntry[]> {
  return invoke<CatEntry[]>('pet_list_cats')
}

/**
 * 设置启动时自动上班的猫 id 列表（基础设置卡片勾选）：更新内存镜像 + 写盘全局配置。
 * 空列表合法（启动不自动打开任何猫）；旧配置无此字段时为空，启动回退 default。
 */
export async function setAutoShowCats(ids: string[]): Promise<void> {
  if (!globalSettings.value) return
  globalSettings.value = {
    ...globalSettings.value,
    autoShowCats: [...new Set(ids)],
  }
  await invoke('pet_save_global', { global: globalSettings.value })
}

// ── 资源根 ───────────────────────────────────────────────────

/** 更换当前猫的资源根目录：调后端校验+写入该猫 cats/<id>.json，并同步 UI ref。 */
export async function changeResourceRoot(path: string): Promise<string> {
  const root = await invoke<string>('pet_set_resource_root', {
    catId: currentCatId.value,
    path,
  })
  // 同步展示 ref，保持与磁盘一致（resourceRoot 是服务端拥有字段，无需再走 saveNow）。
  resourceRoot.value = root
  return root
}

// ── 头像 ─────────────────────────────────────────────────────

/** 保存当前猫头像（base64 data URL）并刷新 asset URL。 */
export async function saveAvatar(dataUrl: string): Promise<void> {
  await invoke('pet_save_avatar', { catId: currentCatId.value, data: dataUrl })
  // 头像已覆盖写，bump 令牌让全窗口所有派生 URL（编辑预览/卡片/选猫弹窗）一起破缓存。
  avatarCacheToken.value = Date.now()
  const p = await invoke<string>('pet_avatar_url', {
    catId: currentCatId.value,
  })
  avatarUrl.value = avatarAssetUrl(p)
  globalSettings.value = await invoke<GlobalSettings>('pet_load_global')
}

/** 删除当前猫头像。 */
export async function resetAvatar(): Promise<void> {
  await invoke('pet_reset_avatar', { catId: currentCatId.value })
  avatarUrl.value = ''
  // bump 令牌：卡片/选猫弹窗据文件消失回落默认图时，也丢弃被删头像的旧缓存。
  avatarCacheToken.value = Date.now()
  globalSettings.value = await invoke<GlobalSettings>('pet_load_global')
}

/** 把当前猫头像设为应用/托盘图标。 */
export async function applyAvatarAsIcon(): Promise<void> {
  await invoke('pet_apply_avatar_as_icon', { catId: currentCatId.value })
}

// ── 跟随光标 / 校准（设置窗 → 猫窗） ─────────────────────────

/** 【设置窗调用】触发当前猫的宠物窗进入头部校准模式。 */
export function startCalibrate(): void {
  emitForCat(START_CALIBRATE_EVENT, true)
}

// ── 跨窗口事件 → 触发保存 ─────────────────────────────────────

/** 任一子模块广播变更后，防抖写当前猫文件。 */
for (const ev of [
  BASIC_SETTINGS_CHANGED_EVENT,
  DISPLAY_SETTINGS_CHANGED_EVENT,
  MENU_SETTINGS_CHANGED_EVENT,
  SPEAK_PHRASES_CHANGED_EVENT,
  SPEAK_PHRASES_DEFAULT_CHANGED_EVENT,
  TRIGGER_BINDINGS_CHANGED_EVENT,
]) {
  listen(ev, () => scheduleSave()).catch(() => {
    // 事件不可用——忽略。
  })
}

// follow 现随 display 广播统一同步（displaySettings 的 listen 已 apply follow），
// 不再需要独立的 follow-changed 监听。

// ── 更新气泡关闭计次 ───────────────────────────────────────────

/** 是否还应该为该版本自动弹「发现新版本」气泡（同一版本最多提醒 2 次）。 */
export function shouldShowUpdateBubble(version: string): boolean {
  const d = globalSettings.value?.updateDismiss
  if (!d || d.version !== version) return true
  return d.count < 2
}

/** 记录一次该版本气泡的关闭；版本变化时计次从 0 重新开始。失败静默忽略。 */
export async function recordUpdateDismiss(version: string): Promise<void> {
  const g = globalSettings.value
  if (!g) return
  const prev = g.updateDismiss
  const count = prev && prev.version === version ? prev.count + 1 : 1
  g.updateDismiss = { version, count }
  try {
    await invoke('pet_save_global', { global: g })
  } catch (e) {
    console.error('保存更新提醒关闭计次失败', e)
  }
}
