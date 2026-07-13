/**
 * 基础设置 —— 宠物名字、出生日期、性别等用户信息。
 *
 * 持久化由 appSettings.ts 统一管理：身份档案存于全局 setting.json 的 cats[id]
 * （不再进 cats/<id>.json）。本模块只持有响应式 ref + 跨窗口同步事件，不直接读写存储。
 * 头像内容单独存文件（avatars/<catId>.png），文件存在与否即头像有无。
 * 默认值见 ./defaults.ts。
 */
import { ref } from 'vue'
import { BASIC_DEFAULTS } from './defaults'
import { emitForCat, listenForCat } from './catContext'

/** 跨窗口同步事件名：当基础设置变更时广播。 */
export const BASIC_SETTINGS_CHANGED_EVENT = 'basic-settings-changed'

/** 基础设置的完整结构。hasAvatar 在全局元数据，不在此。 */
export interface BasicSettings {
  /** 宠物名字；缺省「多多」。 */
  name: string
  /** 出生日期；ISO 日期字符串（YYYY-MM-DD），空表示未设置。 */
  birthday: string
  /** 性别：boy / girl / unknown。 */
  gender: 'boy' | 'girl' | 'unknown'
  /** 用户自定义标签。 */
  tags: string[]
  /** 用户自定义描述/简介。 */
  description: string
}

/** 当前内存中的基础设置；初始为默认值，由 appSettings 启动时填充。 */
export const basicSettings = ref<BasicSettings>({ ...BASIC_DEFAULTS })

/** 从持久化数据填充（appSettings.loadAppSettings 调用）。 */
export function hydrateBasic(data: Partial<BasicSettings> | undefined): void {
  basicSettings.value = {
    name: data?.name ?? BASIC_DEFAULTS.name,
    birthday: data?.birthday ?? BASIC_DEFAULTS.birthday,
    gender: (data?.gender as BasicSettings['gender']) ?? BASIC_DEFAULTS.gender,
    tags: Array.isArray(data?.tags)
      ? data!.tags.filter((t) => typeof t === 'string')
      : [],
    description: typeof data?.description === 'string' ? data.description : '',
  }
}

/** 将当前基础设置广播给其他窗口（持久化由 appSettings 监听本事件后统一写盘）。
 *  payload 带 catId，接收方只应用属于自己那只猫的变更，避免多宠物窗互相污染。 */
export function saveBasicSettings() {
  emitForCat(BASIC_SETTINGS_CHANGED_EVENT, { ...basicSettings.value })
}

/** 恢复默认值（不自动保存，需手动调 saveBasicSettings）。 */
export function resetBasicSettings() {
  basicSettings.value = { ...BASIC_DEFAULTS }
}

/**
 * 跨窗口同步：监听 Tauri 事件，当其他窗口（如设置页）修改了基础设置时，
 * 自动更新当前窗口的 basicSettings 响应式数据。
 */
// 模块级监听，生命周期与应用一致，无需保存注销句柄。
// listenForCat 只应用属于本窗口当前猫的变更（catId 过滤）。
listenForCat<BasicSettings>(BASIC_SETTINGS_CHANGED_EVENT, (data) => {
  basicSettings.value = { ...data }
})
