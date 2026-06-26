/**
 * 猫说话内容配置 —— 每条短语带权重，说话时按权重随机抽取。
 *
 * 配置存 localStorage（key `pet-speak-phrases`），通过 Tauri 事件跨窗口同步。
 */
import { ref } from "vue";
import { listen, emit } from "@tauri-apps/api/event";

/** 跨窗口同步事件名。 */
export const SPEAK_PHRASES_CHANGED_EVENT = "speak-phrases-changed";

/** 单条说话配置。 */
export interface SpeakPhrase {
  /** 显示文字。 */
  text: string;
  /** 权重：越大被随机选中的概率越高，最小为 0。 */
  weight: number;
}

const STORAGE_KEY = "pet-speak-phrases";

/** 默认说话池。 */
export const DEFAULT_SPEAK_PHRASES: SpeakPhrase[] = [
  { text: "喵~", weight: 10 },
  { text: "干嘛戳我！！", weight: 5 },
  { text: "今天也要加油哦！", weight: 5 },
  { text: "我在认真看着你工作呢", weight: 3 },
  { text: "老大，喝口水休息一下吧", weight: 3 },
  { text: "摸鱼一时爽，一直摸鱼一直爽~", weight: 3 },
];

/** 从 localStorage 读取；解析失败或空时返回默认值。 */
function loadPhrases(): SpeakPhrase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter(
            (p: unknown) => p && typeof (p as SpeakPhrase).text === "string",
          )
          .map((p: SpeakPhrase) => ({
            text: p.text.trim(),
            weight: Math.max(0, Number(p.weight) || 0),
          }));
      }
    }
  } catch {
    // 损坏——回退默认。
  }
  return DEFAULT_SPEAK_PHRASES.map((p) => ({ ...p }));
}

/** 当前说话配置；模块级 ref，主窗与设置窗共享。 */
export const speakPhrases = ref<SpeakPhrase[]>(loadPhrases());

/**
 * 按权重随机抽取一条短语。
 * 若所有权重为 0 或池为空，返回空字符串。
 */
export function pickSpeakPhrase(): string {
  const pool = speakPhrases.value.filter((p) => p.text && p.weight > 0);
  if (pool.length === 0) return "";
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let rnd = Math.random() * total;
  for (const p of pool) {
    rnd -= p.weight;
    if (rnd <= 0) return p.text;
  }
  return pool[pool.length - 1].text;
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  emit(SPEAK_PHRASES_CHANGED_EVENT, normalized).catch(() => {});
}

/**
 * 跨窗口同步：监听其他窗口广播的变更事件。
 * 模块级监听，应用生命周期内只需注册一次。
 */
listen<SpeakPhrase[]>(SPEAK_PHRASES_CHANGED_EVENT, (event) => {
  if (!Array.isArray(event.payload)) return;
  speakPhrases.value = event.payload
    .filter((p) => p && typeof p.text === "string")
    .map((p) => ({
      text: p.text.trim(),
      weight: Math.max(0, Number(p.weight) || 0),
    }));
});
