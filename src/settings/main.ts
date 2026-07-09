import { createApp } from "vue";
import SettingsApp from "./SettingsApp.vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  bootstrapIfEmpty,
  loadAppSettings,
  globalSettings,
} from "../pet-core/appSettings";

// 设置窗是 tauri.conf.json 预创建单例（visible:false），JS 启动只加载一次配置；
// 之后每次 open_settings 打开（show）由后端发 settings-activated 事件触发重载，
// 以应用最新的 activeCatId——从宠物窗打开设置页时会写入新 activeCatId 激活那只猫。
listen("settings-activated", () => {
  loadAppSettings().catch(() => {
    // 重载失败时保持现状，不影响打开设置页本身。
  });
});

// 首次启动先 bootstrap（用 defaults.ts 显式写出完整默认猫 + setting.json），
// 再加载统一配置并挂载，确保各子模块 ref 已填充、磁盘配置完整。
// 加载失败不阻断启动（appSettings 内部已吞异常并回退默认）。
(async () => {
  try {
    await bootstrapIfEmpty();
    await loadAppSettings();
    // 启动自动上班：用户在基础设置卡片勾选的猫；旧配置/空列表回退 default。
    const ids = globalSettings.value?.autoShowCats?.length
      ? globalSettings.value.autoShowCats
      : ["default"];
    for (const id of ids) {
      await invoke("pet_show_cat_window", { catId: id }).catch(() => {});
    }
  } catch {
    // 忽略——用默认值启动。
  }
  createApp(SettingsApp).mount("#app");
})();
