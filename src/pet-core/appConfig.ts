// src/pet-core/appConfig.ts —— 服务端远程应用配置（启动拉取一次，暴露 reactive 开关）
import { ref } from "vue";

/** 服务基址：与 ContentHelpDialog / 更新源同源的线上服务。 */
const SERVER_BASE = "https://wuguanwen.cn:10000";

/** 拉取超时（毫秒）：服务慢时不阻塞启动。 */
const FETCH_TIMEOUT = 4000;

/**
 * 是否隐藏「新增小猫」与切换入口（单猫模式）。
 * 默认 true = 隐藏，作为离线/失败兜底：拿不到配置时保持单猫形态。
 */
export const hideAddCat = ref(true);

/** 后端 /api/app-config 的返回结构（首期只有 hideAddCat）。 */
interface AppConfigResp {
  hideAddCat?: boolean;
}

/**
 * 启动时拉取远程配置。成功则写入各 ref；失败（无网/超时/异常）静默保持默认，
 * 绝不抛出、不阻断启动。
 */
export async function loadAppConfig(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const resp = await fetch(`${SERVER_BASE}/api/app-config`, {
      signal: controller.signal,
    });
    if (!resp.ok) return;
    const cfg = (await resp.json()) as AppConfigResp;
    if (typeof cfg.hideAddCat === "boolean") {
      hideAddCat.value = cfg.hideAddCat;
    }
  } catch {
    // 静默：保持默认 true（隐藏），不打扰启动流程。
  } finally {
    clearTimeout(timer);
  }
}
