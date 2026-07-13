// src/pet-core/appConfig.ts —— 服务端远程应用配置（启动拉取一次，暴露 reactive 开关）
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/** 服务基址：与 ContentHelpDialog / 更新源同源的线上服务。 */
const SERVER_BASE = 'https://wuguanwen.cn:10000'

/** 拉取超时（毫秒）：服务慢时不阻塞启动。 */
const FETCH_TIMEOUT = 4000

/**
 * 匿名设备标识：由 Rust 读系统级 MachineGuid 加盐 sha256 得到（见 pet_device_id）。
 * 系统级唯一、重装系统前不变，与安装位置/热更新/配置目录都无关，仅用于后台按设备
 * 去重统计访问人数。取不到时返回空串，服务端据此按无 deviceId 记录，不阻断启动。
 */
async function getDeviceId(): Promise<string> {
  try {
    return await invoke<string>('pet_device_id')
  } catch {
    return ''
  }
}

/**
 * 是否隐藏「新增小猫」与切换入口（单猫模式）。
 * 默认 true = 隐藏，作为离线/失败兜底：拿不到配置时保持单猫形态。
 */
export const hideAddCat = ref(true)

/**
 * 是否在动作库里显示「变换」高级参数（X/Y 偏移、缩放）。
 * 默认 false = 隐藏，作为离线/失败兜底：拿不到配置时收起这些高级项，避免普通用户误改。
 */
export const showTransform = ref(false)

/** 后端 /api/app-config 的返回结构。新增开关时在此登记字段。 */
interface AppConfigResp {
  hideAddCat?: boolean
  showTransform?: boolean
}

/**
 * 启动时拉取远程配置。成功则写入各 ref；失败（无网/超时/异常）静默保持默认，
 * 绝不抛出、不阻断启动。
 */
export async function loadAppConfig(): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    // 带上匿名 deviceId：本接口是应用启动必调点，服务端据此记一条访问事件用于统计。
    const url = `${SERVER_BASE}/api/app-config?deviceId=${encodeURIComponent(await getDeviceId())}`
    const resp = await fetch(url, {
      signal: controller.signal,
    })
    if (!resp.ok) return
    const cfg = (await resp.json()) as AppConfigResp
    if (typeof cfg.hideAddCat === 'boolean') {
      hideAddCat.value = cfg.hideAddCat
    }
    if (typeof cfg.showTransform === 'boolean') {
      showTransform.value = cfg.showTransform
    }
  } catch {
    // 静默：保持默认 true（隐藏），不打扰启动流程。
  } finally {
    clearTimeout(timer)
  }
}
