/**
 * 基础设置 —— 宠物名字、出生日期、性别等用户信息。
 *
 * 全部存在 localStorage， key 前缀 `pet-basic-`。
 * 提供响应式 ref 与保存方法，供多个组件共享。
 * 通过 Tauri 事件系统实现跨窗口同步。
 */
import { ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const STORAGE_KEY = "pet-basic-settings";

/** 跨窗口同步事件名：当基础设置变更时广播。 */
export const BASIC_SETTINGS_CHANGED_EVENT = "basic-settings-changed";

/** 基础设置的完整结构。 */
export interface BasicSettings {
  /** 宠物名字；缺省「多多」。 */
  name: string;
  /** 头像图片地址；缺省为内置 icon.png。 */
  avatar: string;
  /** 出生日期；ISO 日期字符串（YYYY-MM-DD），空表示未设置。 */
  birthday: string;
  /** 性别：boy / girl / unknown。 */
  gender: "boy" | "girl" | "unknown";
}

const DEFAULTS: BasicSettings = {
  name: "多多",
  avatar: "",
  birthday: "",
  gender: "unknown",
};

function load(): BasicSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<BasicSettings>;
    return {
      name: parsed.name ?? DEFAULTS.name,
      avatar: parsed.avatar ?? DEFAULTS.avatar,
      birthday: parsed.birthday ?? DEFAULTS.birthday,
      gender: (parsed.gender as BasicSettings["gender"]) ?? DEFAULTS.gender,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 当前内存中的基础设置；组件可直接绑定其字段。 */
export const basicSettings = ref<BasicSettings>(load());

/** 将当前基础设置写回 localStorage。 */
export function saveBasicSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(basicSettings.value));
}

/** 恢复默认值（不自动保存，需手动调 saveBasicSettings）。 */
export function resetBasicSettings() {
  basicSettings.value = { ...DEFAULTS };
}

/** 自动持久化：任何字段变更都会立即写入 localStorage。 */
watch(
  basicSettings,
  () => {
    saveBasicSettings();
  },
  { deep: true },
);

/**
 * 跨窗口同步：监听 Tauri 事件，当其他窗口（如设置页）修改了基础设置时，
 * 自动更新当前窗口的 basicSettings 响应式数据。
 */
let unlistenBasicSettings: UnlistenFn | undefined;
listen<BasicSettings>(BASIC_SETTINGS_CHANGED_EVENT, (event) => {
  basicSettings.value = { ...event.payload };
}).then((unlisten) => {
  unlistenBasicSettings = unlisten;
});
