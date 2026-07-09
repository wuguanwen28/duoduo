/**
 * 设置窗共享的 manifest 名字读取 —— 解析 manifest.json 的动作 / 行为键名。
 *
 * 设置窗是独立 webview，没有 pet-core 的资源 model，只能通过 `pet_read_manifest`
 * 拿到 manifest 文本再解析。供 DisplaySettings 与 MenuConfigCard 的下拉「动作」/
 * 「行为」组复用。
 */
import { invoke } from "@tauri-apps/api/core";
import { currentCatId } from "./catContext";

/** manifest 解析出的单条动作 / 行为条目。 */
export interface ManifestNameItem {
  /** manifest 键名（英文标识，也是 actionId / behaviorId 的取值）。 */
  key: string;
  /** 界面显示名；manifest 未配置 name 时回退到 key。 */
  label: string;
}

/** manifest 解析出的动作 / 行为集合。 */
export interface ManifestNames {
  actions: ManifestNameItem[];
  behaviors: ManifestNameItem[];
}

/**
 * 读取并解析 manifest.json，返回动作 / 行为键名与中文显示名。
 * 读不到或解析失败时返回空数组（下拉只剩内置 + 随机项），不抛错。
 */
export async function loadManifestNames(): Promise<ManifestNames> {
  try {
    const r = await invoke<{ content: string; exists: boolean }>(
      "pet_read_manifest",
      { catId: currentCatId.value },
    );
    if (!r.exists || !r.content.trim()) return { actions: [], behaviors: [] };
    const m = JSON.parse(r.content) as {
      actions?: Record<string, { name?: string }>;
      behaviors?: Record<string, { name?: string }>;
    };
    const toItems = (map?: Record<string, { name?: string }>): ManifestNameItem[] =>
      map
        ? Object.entries(map).map(([key, def]) => ({
            key,
            label: typeof def?.name === "string" && def.name.trim() ? def.name : key,
          }))
        : [];
    return {
      actions: toItems(m.actions),
      behaviors: toItems(m.behaviors),
    };
  } catch {
    return { actions: [], behaviors: [] };
  }
}
