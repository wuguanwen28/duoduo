/**
 * 当前窗口的猫上下文 —— 独立小模块，避免「各设置子模块 ↔ appSettings」循环依赖。
 *
 * 每个窗口是独立 JS 环境，此 ref 是「本窗口正在编辑/展示的猫 id」：
 * - 宠物窗：启动 loadAppSettings(catId) 后固定为自身猫 id；
 * - 设置窗：随选猫 switchCat 切换。
 *
 * 跨窗口同步事件的 payload 携带 catId，接收方用本值过滤，只应用属于自己那只猫的变更，
 * 从而避免多宠物窗时 A 的广播污染 B 的配置。
 */
import { ref } from "vue";
import { listen, emit } from "@tauri-apps/api/event";

/** 当前窗口正在编辑/展示的猫 id。 */
export const currentCatId = ref("default");

/** 跨窗口事件统一 payload：带 catId，接收方按本窗口 currentCatId 过滤。 */
export interface CatScopedPayload<T> {
  catId: string;
  data: T;
}

/** 以当前猫 id 为 scope 广播一条跨窗口事件。 */
export function emitForCat<T>(event: string, data: T): void {
  emit(event, { catId: currentCatId.value, data } as CatScopedPayload<T>).catch(
    () => {},
  );
}

/**
 * 监听跨窗口事件，只在 payload.catId === 本窗口 currentCatId 时回调。
 * 避免多宠物窗时 A 的广播污染 B 的配置。
 */
export function listenForCat<T>(
  event: string,
  handler: (data: T) => void,
): void {
  listen<CatScopedPayload<T>>(event, (ev) => {
    if (ev.payload?.catId !== currentCatId.value) return;
    handler(ev.payload.data);
  }).catch(() => {});
}
