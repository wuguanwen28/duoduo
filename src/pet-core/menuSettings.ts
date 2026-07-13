/**
 * 右键菜单配置 —— 数据驱动的菜单项列表（环形辐射菜单的数据源）。
 *
 * 菜单项统一通过 actionId 引用动作：
 *   - 内置功能键（如 toggleFollow / minimize / quit 等）；
 *   - action:<名>   引用 manifest.actions 里的某个动作，点一次播一次；
 *   - behavior:<名> 引用 manifest.behaviors 里的某个行为，点一次切过去；
 *   - randomAction / randomBehavior 表示从当前资源里随机挑一个。
 *
 * 持久化由 appSettings.ts 统一管理（~/.duoduo/setting.json）。
 * 【单向同步模式】：只有设置窗会调用 `saveAndBroadcast()` 广播；
 * 主窗只监听事件更新本地状态，永远不广播。
 * 默认菜单与 menuItemId 见 ./defaults.ts。
 */
import { ref } from 'vue'
import { PAW_SLOTS, type PawSlotKey, menuItemId } from './actionCatalog'
import { defaultMenu } from './defaults'
import { emitForCat, listenForCat } from './catContext'
import type { SpeakPhrase } from './speakPhrases'

// PAW_SLOTS / PawSlotKey / menuItemId 已迁至零依赖的 actionCatalog、defaultMenu 迁至 defaults；
// 从此处 re-export 兼容旧引用（Menu.vue / MenuConfigCard.vue 仍从 menuSettings 拿）。
export { PAW_SLOTS, type PawSlotKey, menuItemId }
export { defaultMenu }

/** 跨窗口同步事件名。 */
export const MENU_SETTINGS_CHANGED_EVENT = 'menu-settings-changed'

/** 菜单项配置：统一用 actionId 引用动作（内置键 / action:<名> / behavior:<名> / randomAction / randomBehavior）。 */
export interface MenuItemConfig {
  /** 唯一 id（基于 actionId），用于拖拽列表的 key 与去重。 */
  id: string
  /** 动作引用，见统一 actionId 方案。 */
  actionId: string
  /** 展示用中文标签（菜单上显示）。 */
  label: string
  /**
   * 仅 actionId 为 speak / pokeAndSpeak 时有意义：该菜单项的独立说话短语池。
   * 缺省时说话为空（不出气泡）。
   */
  phrases?: SpeakPhrase[]
}

/** 校验单个菜单项结构是否合法。 */
function isValidItem(x: any): x is MenuItemConfig {
  return x && typeof x.actionId === 'string' && typeof x.label === 'string'
}

/** 当前菜单配置；初始为默认菜单，由 appSettings 启动时填充。 */
export const menuSettings = ref<MenuItemConfig[]>(defaultMenu())

/** 从持久化数据填充；缺失、非法、或解析后为空时回退到默认菜单。 */
export function hydrateMenu(data: MenuItemConfig[] | undefined): void {
  if (!Array.isArray(data) || data.length === 0) {
    menuSettings.value = defaultMenu()
    return
  }
  const items = data.filter(isValidItem)
  menuSettings.value = items.length > 0 ? items : defaultMenu()
}

/**
 * 【仅设置窗调用】广播一次（持久化由 appSettings 监听本事件后统一写盘）。
 * 主窗不要调用这个函数！
 */
export function saveAndBroadcast(): void {
  emitForCat(MENU_SETTINGS_CHANGED_EVENT, menuSettings.value)
}

/**
 * 跨窗口同步：只应用属于本窗口当前猫的变更（catId 过滤）。
 * 比较序列化结果，避免无谓赋值。
 */
listenForCat<MenuItemConfig[]>(MENU_SETTINGS_CHANGED_EVENT, (data) => {
  if (!Array.isArray(data)) return
  if (JSON.stringify(data) !== JSON.stringify(menuSettings.value)) {
    menuSettings.value = data
  }
})
