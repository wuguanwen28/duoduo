/**
 * 用户配置的业务默认值集中处（单一来源）。
 *
 * 各设置子模块与 appSettings 均从此处取默认值——这里是业务默认值的唯一真源。
 * Rust 端 settings.rs 的 Default 只给空集合 + 渲染安全标量（不再手抄内容默认值）：
 * 配置损坏时后端返回空集合，前端 hydrate 自动回退到此处，无需再与 Rust 逐值对齐。
 * 例外：display 是渲染安全标量（size/opacity 不能为 0），两端需保持同值。
 *
 * 依赖约束：只 import 零依赖的 actionCatalog（构造默认菜单）与各模块的**类型**，
 * 不引入运行时循环。
 */
import { findBuiltin, menuItemId } from './actionCatalog'
import type { BasicSettings } from './basicSettings'
import type { DisplayStored } from './displaySettings'
import type { MenuItemConfig } from './menuSettings'
import type { SpeakPhrase } from './speakPhrases'
import type { TriggerBinding } from './triggerBindings'

/** 基础信息默认值。hasAvatar 不在此（在全局元数据）。 */
export const BASIC_DEFAULTS: BasicSettings = {
  name: '多多',
  birthday: '2023-08-05 00:00',
  gender: 'girl',
  tags: ['唱', '跳', 'rap', '篮球'],
  description: '一只有才华的猫，喜欢唱歌、跳舞、rap和篮球。人送外号[多kun]',
}

/** 显示设置默认值（含跟随开关与头部校准偏移——存储上归 display）。 */
export const DISPLAY_DEFAULTS: DisplayStored = {
  size: 0.5,
  opacity: 1,
  alwaysOnTop: true,
  passthrough: false,
  follow: true,
  headOffset: { x: 0, y: 0 },
}

/** 默认说话池（出厂默认，用户可编辑独立的「默认说话模板」）。 */
export const DEFAULT_SPEAK_PHRASES: SpeakPhrase[] = [
  { text: '喵~', weight: 1 },
  { text: '戳我干鸡毛？', weight: 1 },
  { text: '今天也要加油哦！', weight: 1 },
  { text: '唱、跳、rap、篮球', weight: 1 },
  { text: '我在认真看着你工作呢', weight: 1 },
  { text: '老大，喝口水休息一下吧', weight: 1 },
  { text: '摸鱼一时爽，一直摸鱼一直爽~', weight: 1 },
]

/** 默认触发器绑定（鼠标 4 条 + 快捷键 3 条）。 */
export const DEFAULT_TRIGGER_BINDINGS: TriggerBinding[] = [
  {
    id: 'm-leftClick',
    kind: 'mouse',
    trigger: 'leftClick',
    actionId: 'pokeAndSpeak',
  },
  {
    id: 'm-doubleClick',
    kind: 'mouse',
    trigger: 'doubleClick',
    actionId: 'minimize',
  },
  {
    id: 'm-rightClick',
    kind: 'mouse',
    trigger: 'rightClick',
    actionId: 'openMenu',
  },
  { id: 'm-longPress', kind: 'mouse', trigger: 'longPress', actionId: '' },
  {
    id: 'k-boss',
    kind: 'key',
    trigger: 'Alt+Z',
    actionId: 'minimize',
    isGlobal: true,
  },
]

/** 由内置目录 key 构造一个默认菜单项（label 取自 actionCatalog）。 */
function builtinItem(key: string): MenuItemConfig {
  const b = findBuiltin(key)!
  return {
    id: menuItemId(key),
    actionId: key,
    label: b.menuLabel,
  }
}

/**
 * 首次默认菜单（5 个固定槽位）：全部用内置动作，不引用任何资源动作/行为，
 * 保证首次启动（尚无 manifest 动作/行为）时每一项都可用。
 */
export function defaultMenu(): MenuItemConfig[] {
  return [
    builtinItem('toggleFollow'), // 左趾
    builtinItem('togglePassthrough'), // 左中趾
    builtinItem('calibrate'), // 右中趾
    builtinItem('offWork'), // 右趾：下班（关闭当前窗口）
    builtinItem('minimize'), // 掌垫：老板来了（切换全部显隐）
  ]
}
