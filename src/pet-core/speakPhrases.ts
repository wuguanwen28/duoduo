/**
 * 猫说话内容配置 —— 每条短语带权重，说话时按权重随机抽取。
 *
 * 持久化由 appSettings.ts 统一管理（~/.duoduo/setting.json），通过 Tauri 事件跨窗口同步。
 * 默认短语见 ./defaults.ts。
 */
import { ref } from "vue";
import { DEFAULT_SPEAK_PHRASES } from "./defaults";
import { emitForCat, listenForCat } from "./catContext";

/** 跨窗口同步事件名。 */
export const SPEAK_PHRASES_CHANGED_EVENT = "speak-phrases-changed";

/** 默认说话模板跨窗口同步事件名。 */
export const SPEAK_PHRASES_DEFAULT_CHANGED_EVENT = "speak-phrases-default-changed";

/** 单条说话配置。 */
export interface SpeakPhrase {
  /** 显示文字。 */
  text: string;
  /** 权重：越大被随机选中的概率越高，最小为 0。 */
  weight: number;
}

/** 规整短语数组：过滤无文本项、修剪空白、权重非负。 */
function normalizePhrases(list: any[]): SpeakPhrase[] {
  return list
    .filter((p) => p && typeof p.text === "string")
    .map((p) => ({ text: String(p.text).trim(), weight: Math.max(0, Number(p.weight) || 0) }));
}

/** 当前说话配置；初始为出厂默认，由 appSettings 启动时填充。 */
export const speakPhrases = ref<SpeakPhrase[]>(DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p })));

/** 当前默认说话模板；初始为出厂默认，由 appSettings 启动时填充。 */
export const defaultSpeakPhrases = ref<SpeakPhrase[]>(
  DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p })),
);

/** 从持久化数据填充说话配置；缺失/损坏/空时回退出厂默认。 */
export function hydrateSpeakPhrases(data: any): void {
  if (Array.isArray(data) && data.length > 0) {
    const normalized = normalizePhrases(data);
    speakPhrases.value =
      normalized.length > 0
        ? normalized
        : DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p }));
  } else {
    speakPhrases.value = DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p }));
  }
}

/** 从持久化数据填充默认模板；缺失/损坏/空时回退出厂默认。 */
export function hydrateDefaultSpeakPhrases(data: any): void {
  if (Array.isArray(data) && data.length > 0) {
    const normalized = normalizePhrases(data);
    defaultSpeakPhrases.value =
      normalized.length > 0
        ? normalized
        : DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p }));
  } else {
    defaultSpeakPhrases.value = DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p }));
  }
}

/**
 * 按权重随机抽取一条短语。
 * 若所有权重为 0 或池为空，返回空字符串。
 */
export function pickSpeakPhrase(): string {
  return pickFromPool(speakPhrases.value);
}

/**
 * 从指定短语池里按权重随机挑一条。
 * 池为空或全 0 权重时返回空字符串。各说话入口（菜单 / 触发器 / 行为 random）
 * 各自维护独立池，执行时把对应池传进来。
 */
export function pickFromPool(pool: SpeakPhrase[]): string {
  const valid = (Array.isArray(pool) ? pool : []).filter((p) => p && p.text && p.weight > 0);
  if (valid.length === 0) return "";
  const total = valid.reduce((sum, p) => sum + p.weight, 0);
  let rnd = Math.random() * total;
  for (const p of valid) {
    rnd -= p.weight;
    if (rnd <= 0) return p.text;
  }
  return valid[valid.length - 1].text;
}

/**
 * 保存并广播说话配置变更。
 * 设置窗调用；主窗只监听不广播。
 */
export function saveSpeakPhrases(phrases: SpeakPhrase[]): void {
  const normalized = phrases
    .filter((p) => p.text.trim() !== "")
    .map((p) => ({ text: p.text.trim(), weight: Math.max(0, p.weight) }));
  speakPhrases.value = normalized;
  emitForCat(SPEAK_PHRASES_CHANGED_EVENT, normalized);
}

/** 跨窗口同步：只应用属于本窗口当前猫的变更（catId 过滤）。 */
listenForCat<SpeakPhrase[]>(SPEAK_PHRASES_CHANGED_EVENT, (data) => {
  if (!Array.isArray(data)) return;
  speakPhrases.value = normalizePhrases(data);
});

// ── 默认说话模板（用户可编辑的「默认说话内容」，一键写入到任意说话入口） ──

/**
 * 保存并广播默认模板变更。设置窗调用；主窗只监听。
 */
export function saveDefaultSpeakPhrases(phrases: SpeakPhrase[]): void {
  const normalized = phrases
    .filter((p) => p.text.trim() !== "")
    .map((p) => ({ text: p.text.trim(), weight: Math.max(0, p.weight) }));
  const fallback =
    normalized.length > 0
      ? normalized
      : DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p }));
  defaultSpeakPhrases.value = fallback;
  emitForCat(SPEAK_PHRASES_DEFAULT_CHANGED_EVENT, fallback);
}

/** 跨窗口同步默认模板：只应用属于本窗口当前猫的变更（catId 过滤）。 */
listenForCat<SpeakPhrase[]>(SPEAK_PHRASES_DEFAULT_CHANGED_EVENT, (data) => {
  if (!Array.isArray(data)) return;
  defaultSpeakPhrases.value = normalizePhrases(data);
});
