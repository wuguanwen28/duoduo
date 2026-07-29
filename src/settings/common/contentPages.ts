// src/settings/common/contentPages.ts -- 说明固定页面清单（桌面端）

/**
 * 固定页面清单：与 server 端 server/utils/content.ts 的 CONTENT_PAGES 保持一致。
 * 每个设置页一个固定 page key，ContentHelp 传 page 后会拉取该页面下的全部说明
 * （一个页面可挂多条），渲染为多个入口按钮。
 * 新增设置页说明入口时，前后端两份清单都要同步登记。
 */
export const CONTENT_PAGES = [
  { page: 'basic', label: '基础设置页' },
  { page: 'display', label: '显示与交互页' },
  { page: 'resource', label: '资源设置页' },
  { page: 'tools', label: '视频转帧页' },
  { page: 'update', label: '关于页' },
] as const

/** page key 联合类型，用于 ContentHelp 的 page prop 校验，避免拼错。 */
export type ContentPage = (typeof CONTENT_PAGES)[number]['page']
