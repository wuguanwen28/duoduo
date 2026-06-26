# 手势与快捷键统一触发器模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把鼠标手势与键盘快捷键合并为单一 `TriggerBinding[]`（前 4 条固定鼠标 + 后续动态快捷键），共用 `PET_ACTIONS` 分发；旧配置迁移；快捷键编辑时实时检测全局键占用。

**Architecture:** 新建 `useTriggerBindings.ts` 承载统一模型 + 迁移 + 广播 + 按键序列化；删除 `useGestureConfig.ts`、`useShortcuts.ts`。`useGestures.ts` 改为从数组按 trigger 查 mouse 动作。`Pet.vue` 抽 `petCtx` 变量、删独立 `shortcutActions`、`applyTriggerBindings` 统一分发。`DisplaySettings.vue` 把点击设置 + 快捷键合并为单一「触发器」卡片，支持增删改 + 实时冲突探测。

**Tech Stack:** Vue 3.5 `<script setup>` + TypeScript + Element Plus + Tauri 2（`@tauri-apps/plugin-global-shortcut`、`@tauri-apps/api/event`）。无测试框架——以 `vue-tsc --noEmit` + 手动验证为准。

## Global Constraints

- **注释一律中文**，使用文档注释 `/** */`（项目约定，见 CLAUDE.md）。
- **新 localStorage key `duoduo-trigger-bindings`**；旧 key `pet-gesture-config` / `duoduo-shortcuts` 迁移后不清除（保留回退，但后续只认新 key）。
- **导航 key `display` 不变**（兼容 Rust 端 `navigate-to` 事件）；仅改显示标签为「显示与交互」。
- **不新增 `bossComing` 动作**——「老板来了」复用 `minimize`。
- **鼠标 4 条不可删/不可改触发方式**，仅可改动作。
- **不新增 Tauri 后端命令**。
- `SHORTCUT_ACTION_KEYS` 不含 `startCalibrate`（仓库无实现）。
- 类型检查命令：`npx vue-tsc --noEmit`。
- 工作目录：`D:\project\duoduo1`，分支 `master`，包管理器 pnpm。
- 为避免中间提交类型不过：Task 2+3 一起提交、Task 5+6 一起提交、Task 7 单独提交。

---

## File Structure

| 文件 | 责任 | 改动 |
| --- | --- | --- |
| `src/composables/usePetActions.ts` | 动作仓库 | 加 `SHORTCUT_ACTION_KEYS`、`MOUSE_TRIGGER_LABELS` |
| `src/composables/useTriggerBindings.ts` | 统一模型+迁移+广播+按键序列化 | **新建** |
| `src/composables/useGestures.ts` | 手势引擎 | 改读 `TriggerBinding[]` |
| `src/composables/useGestureConfig.ts` | （旧手势配置） | **删除** |
| `src/composables/useShortcuts.ts` | （旧快捷键） | **删除** |
| `src/components/Pet/Pet.vue` | 主窗分发 | 抽 `petCtx`、删 `shortcutActions`、`applyTriggerBindings` |
| `src/settings/DisplaySettings.vue` | 显示与交互页 | 合并触发器卡片、实时冲突探测 |
| `src/settings/ShortcutSettings.vue` | （旧快捷键页） | **删除** |
| `src/settings/SettingsApp.vue` | 设置窗导航 | 删 shortcuts 项、改标签 |

---

## Task 1: 动作仓库加 `SHORTCUT_ACTION_KEYS` 与 `MOUSE_TRIGGER_LABELS`

**Files:**
- Modify: `src/composables/usePetActions.ts`

**Interfaces:**
- Produces: `SHORTCUT_ACTION_KEYS: string[]`、`MOUSE_TRIGGER_LABELS: Record<string, string>`

- [ ] **Step 1: 新增 `SHORTCUT_ACTION_KEYS`**

在 `src/composables/usePetActions.ts` 末尾 `GESTURE_ACTION_KEYS` 之后追加：

```ts
/**
 * 允许在快捷键配置中绑定的动作 key。
 * 含状态切换类与最小化；不含 `startCalibrate`（仓库尚无实现）、不含 `bossComing`
 * （「老板来了」直接复用 minimize）。
 */
export const SHORTCUT_ACTION_KEYS: string[] = [
  "none",
  "wake",
  "poke",
  "speak",
  "pokeAndSpeak",
  "openMenu",
  "openSettings",
  "minimize",
  "toggleFollow",
  "togglePassthrough",
  "quit",
];
```

- [ ] **Step 2: 新增 `MOUSE_TRIGGER_LABELS`**

紧接 `SHORTCUT_ACTION_KEYS` 之后追加：

```ts
/** 鼠标手势触发方式的中文标签，供设置页只读显示。 */
export const MOUSE_TRIGGER_LABELS: Record<string, string> = {
  leftClick: "左键单击",
  doubleClick: "左键双击",
  rightClick: "右键",
  longPress: "长按",
};
```

- [ ] **Step 3: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无输出（通过）。

- [ ] **Step 4: Commit**

```bash
git add src/composables/usePetActions.ts
git commit -m "feat: 动作仓库加 SHORTCUT_ACTION_KEYS 与 MOUSE_TRIGGER_LABELS"
```

---

## Task 2: 新建 `useTriggerBindings.ts`（统一模型 + 迁移 + 广播 + 按键序列化）

**Files:**
- Create: `src/composables/useTriggerBindings.ts`

**Interfaces:**
- Produces: `TriggerKind`、`MouseTrigger`、`TriggerBinding`、`DEFAULT_TRIGGER_BINDINGS`、`loadTriggerBindings(): TriggerBinding[]`、`saveTriggerBindings(entries)`、`TRIGGER_BINDINGS_CHANGED_EVENT`、`TRIGGER_BINDINGS_RESULT_EVENT`、`TriggerResult`、`serializeKeyEvent`、`matchesKey`、`toAccelerator`、`formatKey`
- 按键序列化逻辑从 `useShortcuts.ts` 迁入（`serializeKeyEvent`/`matchesKey`/`toAccelerator`/`formatKey`）

> 本任务只新建文件，不改任何引用方，故单独提交类型可通过。

- [ ] **Step 1: 创建 `useTriggerBindings.ts`**

写入 `src/composables/useTriggerBindings.ts`：

```ts
/**
 * 触发器-动作统一绑定 —— 手势与快捷键合并为单一数组。
 *
 * - 鼠标手势（前4条固定）：trigger 为 MouseTrigger 枚举，仅可改动作。
 * - 键盘快捷键（动态新增）：trigger 为按键串，可改动作 / 作用域 / 删除。
 * 两者动作统一引用 PET_ACTIONS，由主窗分发时查表执行。
 *
 * 配置存 localStorage（key `duoduo-trigger-bindings`），并通过 Tauri 事件
 * 在设置窗与主窗之间同步。旧手势配置（`pet-gesture-config`）与旧快捷键
 * 配置（`duoduo-shortcuts`）首次加载时合并迁移，迁移后旧 key 保留作回退。
 */
import { ref } from "vue";
import { emit } from "@tauri-apps/api/event";

/** 触发类型。 */
export type TriggerKind = "mouse" | "key";

/** 鼠标手势的固定触发方式枚举。 */
export type MouseTrigger = "leftClick" | "doubleClick" | "rightClick" | "longPress";

/** 单条触发器-动作绑定。 */
export interface TriggerBinding {
  /** 稳定标识，用于持久化 / 分发 / 冲突标记 / v-for key。 */
  id: string;
  /** 触发类型：mouse=鼠标手势（前4条固定），key=键盘快捷键（动态新增）。 */
  kind: TriggerKind;
  /**
   * 触发方式：
   * - kind=mouse：MouseTrigger 枚举值（只读）。
   * - kind=key：录制出的按键串 "Alt+Z"；空串=未绑定。
   */
  trigger: string;
  /** 触发动作，引用 PET_ACTIONS 的 key。 */
  actionId: string;
  /** 仅 kind=key 有效：是否系统层全局注册。mouse 不使用此字段。 */
  isGlobal?: boolean;
}

/** localStorage 键。 */
export const TRIGGER_BINDINGS_STORAGE_KEY = "duoduo-trigger-bindings";

/** 设置窗改动保存后广播；主窗收到后重新应用全部绑定。 */
export const TRIGGER_BINDINGS_CHANGED_EVENT = "trigger-bindings-changed";

/** 主窗应用后回传注册结果；设置窗据此把被占用的全局键标红。 */
export const TRIGGER_BINDINGS_RESULT_EVENT = "trigger-bindings-result";

/** 主窗回传的注册结果载荷。 */
export interface TriggerResult {
  /** 注册失败（疑似被其他程序占用）的全局快捷键 id 列表。 */
  failedIds: string[];
}

/** 旧手势配置的 trigger → id 固定映射（迁移用）。 */
const MOUSE_IDS: Record<MouseTrigger, string> = {
  leftClick: "m-leftClick",
  doubleClick: "m-doubleClick",
  rightClick: "m-rightClick",
  longPress: "m-longPress",
};

/** 旧快捷键 id → 迁移用 actionId 映射（boss-coming 一律迁成 minimize）。 */
const LEGACY_KEY_ACTION: Record<string, string> = {
  "boss-coming": "minimize",
  "open-settings": "openSettings",
  "toggle-passthrough": "togglePassthrough",
};

/** 旧快捷键 id → 迁移用 isGlobal 来源。 */
const LEGACY_KEY_GLOBAL: Record<string, boolean> = {
  "boss-coming": true,
  "open-settings": false,
  "toggle-passthrough": false,
};

/**
 * 默认预置绑定（首次加载无任何配置、或「恢复默认」时用）。
 * 鼠标 4 条默认与原 DEFAULT_GESTURE_CONFIG 一致；快捷键 3 条与原 SHORTCUT_DEFS
 * 一致，其中「老板来了」直接绑 minimize（它本就是最小化的别名）。
 */
export const DEFAULT_TRIGGER_BINDINGS: TriggerBinding[] = [
  { id: "m-leftClick", kind: "mouse", trigger: "leftClick", actionId: "pokeAndSpeak" },
  { id: "m-doubleClick", kind: "mouse", trigger: "doubleClick", actionId: "minimize" },
  { id: "m-rightClick", kind: "mouse", trigger: "rightClick", actionId: "openMenu" },
  { id: "m-longPress", kind: "mouse", trigger: "longPress", actionId: "wake" },
  { id: "k-boss", kind: "key", trigger: "Alt+Z", actionId: "minimize", isGlobal: true },
  { id: "k-settings", kind: "key", trigger: "Alt+S", actionId: "openSettings", isGlobal: false },
  { id: "k-passthrough", kind: "key", trigger: "Alt+C", actionId: "togglePassthrough", isGlobal: false },
];

/** localStorage 持久化结构：仅含 entries 一字段，便于与旧格式区分。 */
interface StoredBindings {
  entries: TriggerBinding[];
}

/** 旧快捷键新格式（useShortcuts v1 曾用过的 {entries} 结构）。 */
interface LegacyShortcutsEntries {
  entries: { id: string; key: string; scope: "global" | "app"; actionId: string }[];
}

/**
 * 从 localStorage 读取触发器绑定列表。
 *
 * 优先级：
 * 1) 新格式（`{ entries: [...] }`）直接用；
 * 2) 旧手势 + 旧快捷键配置合并迁移，迁移后写回新 key；
 * 3) 都没有 → 默认预置（不写盘）。
 * 迁移幂等：读到新 key 即走分支 1，不再迁移。
 */
export function loadTriggerBindings(): TriggerBinding[] {
  let rawNew: string | null = null;
  try {
    rawNew = localStorage.getItem(TRIGGER_BINDINGS_STORAGE_KEY);
  } catch {
    return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));
  }

  // 分支 1：新格式
  if (rawNew) {
    try {
      const parsed = JSON.parse(rawNew) as StoredBindings;
      if (parsed && Array.isArray(parsed.entries)) {
        return parsed.entries.map((e) => ({ ...e }));
      }
    } catch {
      // 损坏 → 继续走迁移 / 默认
    }
  }

  // 分支 2：旧配置合并迁移
  const entries = migrateFromLegacy();
  if (entries) {
    saveTriggerBindings(entries);
    return entries;
  }

  // 分支 3：默认预置
  return DEFAULT_TRIGGER_BINDINGS.map((e) => ({ ...e }));
}

/**
 * 从旧手势配置（pet-gesture-config）与旧快捷键配置（duoduo-shortcuts）
 * 合并迁移出 TriggerBinding[]；任一旧配置都没有时返回 null。
 */
function migrateFromLegacy(): TriggerBinding[] | null {
  let gestureRaw: string | null = null;
  let shortcutRaw: string | null = null;
  try {
    gestureRaw = localStorage.getItem("pet-gesture-config");
    shortcutRaw = localStorage.getItem("duoduo-shortcuts");
  } catch {
    return null;
  }
  if (!gestureRaw && !shortcutRaw) return null;

  const entries: TriggerBinding[] = [];

  // 鼠标 4 条：从旧手势配置取 actionId，trigger 固定。
  let gesture: Record<string, string> | null = null;
  if (gestureRaw) {
    try {
      gesture = JSON.parse(gestureRaw) as Record<string, string>;
    } catch {
      gesture = null;
    }
  }
  const mouseDefaults: Record<MouseTrigger, string> = {
    leftClick: "pokeAndSpeak",
    doubleClick: "minimize",
    rightClick: "openMenu",
    longPress: "wake",
  };
  (Object.keys(MOUSE_IDS) as MouseTrigger[]).forEach((trigger) => {
    entries.push({
      id: MOUSE_IDS[trigger],
      kind: "mouse",
      trigger,
      actionId: gesture?.[trigger] ?? mouseDefaults[trigger],
    });
  });

  // 快捷键：从旧快捷键配置取，兼容旧裸对象与 {entries} 两种格式。
  if (shortcutRaw) {
    try {
      const parsed = JSON.parse(shortcutRaw);
      // {entries: [...]} 格式
      if (parsed && Array.isArray((parsed as LegacyShortcutsEntries).entries)) {
        for (const e of (parsed as LegacyShortcutsEntries).entries) {
          entries.push({
            id: e.id,
            kind: "key",
            trigger: e.key ?? "",
            actionId: e.actionId ?? "none",
            isGlobal: e.scope === "global",
          });
        }
      } else if (parsed && typeof parsed === "object") {
        // 旧裸对象 { "boss-coming": "Alt+Z", ... }
        const legacy = parsed as Record<string, string>;
        for (const id of Object.keys(LEGACY_KEY_ACTION)) {
          entries.push({
            id,
            kind: "key",
            trigger: typeof legacy[id] === "string" ? legacy[id] : "",
            actionId: LEGACY_KEY_ACTION[id],
            isGlobal: LEGACY_KEY_GLOBAL[id],
          });
        }
      }
    } catch {
      // 快捷键解析失败——仅保留已迁移的鼠标 4 条。
    }
  }

  return entries;
}

/** 把绑定列表写回 localStorage（新格式 `{ entries }`，全量写入）。 */
export function saveTriggerBindings(entries: TriggerBinding[]): void {
  const data: StoredBindings = { entries: entries.map((e) => ({ ...e })) };
  localStorage.setItem(TRIGGER_BINDINGS_STORAGE_KEY, JSON.stringify(data));
}

/** 当前生效的触发器绑定（模块级 ref，主窗读它）。 */
export const triggerBindings = ref<TriggerBinding[]>(loadTriggerBindings());

// ── 按键序列化（从原 useShortcuts 迁入） ────────────────────────

/**
 * 把键盘事件序列化为内部按键串（如 `"Ctrl+Shift+A"`）。
 * 纯修饰键、Escape 返回 `null`（调用方据此忽略或取消录制）。
 */
export function serializeKeyEvent(e: KeyboardEvent): string | null {
  const { ctrlKey, shiftKey, altKey, metaKey, key } = e;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  if (key === "Escape") return null;
  const parts: string[] = [];
  if (ctrlKey) parts.push("Ctrl");
  if (shiftKey) parts.push("Shift");
  if (altKey) parts.push("Alt");
  if (metaKey) parts.push("Meta");
  let mainKey = key;
  if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
  else if (mainKey === " ") mainKey = "Space";
  parts.push(mainKey);
  return parts.join("+");
}

/** 判断某次 keydown 是否命中给定按键串（用于应用内快捷键匹配）。 */
export function matchesKey(e: KeyboardEvent, key: string): boolean {
  if (!key) return false;
  return serializeKeyEvent(e) === key;
}

/** 内部修饰键 → Tauri accelerator 修饰键名。 */
const ACCEL_MODIFIERS: Record<string, string> = {
  Ctrl: "Control",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "Super",
};

/** 个别主键名到 Tauri accelerator 的映射（其余字母/数字/功能键直接透传）。 */
const ACCEL_KEYS: Record<string, string> = {
  Space: "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/**
 * 把内部按键串转成 global-shortcut 接受的 accelerator
 * （如 `"Ctrl+Shift+A"` → `"Control+Shift+A"`）。空串返回空串。
 */
export function toAccelerator(key: string): string {
  if (!key) return "";
  const parts = key.split("+");
  const out: string[] = [];
  parts.forEach((p, i) => {
    if (i < parts.length - 1) {
      out.push(ACCEL_MODIFIERS[p] ?? p);
    } else {
      out.push(ACCEL_KEYS[p] ?? p);
    }
  });
  return out.join("+");
}

/** 把按键串格式化为更友好的显示文本（`Meta` 显示为 `Win`）。 */
export function formatKey(key: string): string {
  return key
    .split("+")
    .map((k) => (k === "Meta" ? "Win" : k))
    .join(" + ");
}
```

- [ ] **Step 2: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无输出（新文件独立，无外部引用冲突）。

- [ ] **Step 3: Commit**

```bash
git add src/composables/useTriggerBindings.ts
git commit -m "feat: 新建 useTriggerBindings 统一触发器模型与迁移"
```

---

## Task 3: `useGestures.ts` 改读 `TriggerBinding[]`

**Files:**
- Modify: `src/composables/useGestures.ts`

**Interfaces:**
- Consumes: `TriggerBinding`、`MouseTrigger`（from useTriggerBindings）
- Produces: `useGestures(elRef, bindings: Ref<TriggerBinding[]>, actions, ctx)`
- 改动：`config.value.leftClick` 等 → `mouseAction("leftClick")` 等

> 注意：本任务改 useGestures 签名后，`Pet.vue`（Task 4）和旧 `DisplaySettings.vue`（仍 import useGestureConfig）会类型不过。Task 4 修复 Pet.vue；DisplaySettings 在 Task 6 整体重写。为避免中间提交不过，**本任务与 Task 4 一起提交**。

- [ ] **Step 1: 改 import 与签名**

把 `src/composables/useGestures.ts` 顶部 import 改为：

```ts
import { onMounted, onUnmounted, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { TriggerBinding, MouseTrigger } from "./useTriggerBindings";
import type { PetAction, PetActionContext } from "./usePetActions";
```

把 `useGestures` 函数签名改为：

```ts
export function useGestures(
  elRef: Ref<HTMLElement | undefined>,
  bindings: Ref<TriggerBinding[]>,
  actions: Record<string, PetAction>,
  ctx: PetActionContext,
): void {
```

- [ ] **Step 2: 加 `mouseAction` 查找函数并替换分发点**

在 `useGestures` 函数体顶部（`let lastClickTime = 0;` 之前）加：

```ts
  /** 按 mouse 触发方式从绑定数组查 actionId；找不到降级 none。 */
  function mouseAction(trigger: MouseTrigger): string {
    return (
      bindings.value.find((b) => b.kind === "mouse" && b.trigger === trigger)?.actionId ?? "none"
    );
  }
```

替换四处分发调用：
- `dispatch(config.value.doubleClick, start)` → `dispatch(mouseAction("doubleClick"), start)`
- `dispatch(config.value.leftClick, start)` → `dispatch(mouseAction("leftClick"), start)`
- `dispatch(config.value.longPress, start)` → `dispatch(mouseAction("longPress"), start)`
- `dispatch(config.value.rightClick, { x: e.clientX, y: e.clientY })` → `dispatch(mouseAction("rightClick"), { x: e.clientX, y: e.clientY })`

- [ ] **Step 3: 类型检查（预期 Pet.vue 仍报错，Task 4 修）**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: `Pet.vue` 报 `gestureConfig`/`useGestures` 参数类型不匹配；`useGestures.ts` 自身无错。**不单独提交**，继续 Task 4。

---

## Task 4: `Pet.vue` 抽 `petCtx`、删 `shortcutActions`、`applyTriggerBindings`

**Files:**
- Modify: `src/components/Pet/Pet.vue`

**Interfaces:**
- Consumes: `triggerBindings`、`TriggerBinding`、`loadTriggerBindings`、`TRIGGER_BINDINGS_CHANGED_EVENT`、`TRIGGER_BINDINGS_RESULT_EVENT`、`TriggerResult`、`matchesKey`、`toAccelerator`（from useTriggerBindings）；`PET_ACTIONS`、`PetActionContext`（from usePetActions）
- 现有可用：`PET_ACTIONS`（Pet.vue:101 import）、`showToast`（:464）、`register`/`unregisterAll`（:88 import）、`emit`、`passthrough`

> 关键：传给 `useGestures` 的 ctx 是内联对象字面量（:317），需抽成变量 `petCtx` 供快捷键分发复用。

- [ ] **Step 1: 改 import**

把 `src/components/Pet/Pet.vue:100` 的 `import { gestureConfig } from "../../composables/useGestureConfig";` **删除**。

把 `:101` 的 `import { PET_ACTIONS } from "../../composables/usePetActions";` 改为：

```ts
import { PET_ACTIONS, type PetActionContext } from "../../composables/usePetActions";
```

把 `:104-112` 的 useShortcuts import 整段替换为：

```ts
import {
  triggerBindings,
  TRIGGER_BINDINGS_CHANGED_EVENT,
  TRIGGER_BINDINGS_RESULT_EVENT,
  matchesKey,
  toAccelerator,
  type TriggerResult,
} from "../../composables/useTriggerBindings";
```

- [ ] **Step 2: 抽 `petCtx` 变量**

把 `:317` 附近的内联传参：

```ts
useGestures(catWrapRef, gestureConfig, PET_ACTIONS, {
  brain,
  menuOpen,
  calibrating,
  followCursor,
  passthrough,
  say,
  placeMenuAt,
  pendingMenuPos,
});
```

（字段以 Pet.vue 实际为准——读 :317-326 确认。）替换为：

```ts
/** 动作执行上下文；手势与快捷键共用同一份。 */
const petCtx: PetActionContext = {
  brain,
  menuOpen,
  calibrating,
  followCursor,
  passthrough,
  say,
  placeMenuAt,
  pendingMenuPos,
};

useGestures(catWrapRef, triggerBindings, PET_ACTIONS, petCtx);
```

- [ ] **Step 3: 删 `shortcutActions` map，改统一分发**

把 `:468-483`（`// ── 快捷键 ──` 注释 + `shortcutActions` 对象）替换为：

```ts
// ── 快捷键 ───────────────────────────────────────────────────────
// 全局键经 global-shortcut 插件在系统层注册，任何程序活跃时都触发；
// 应用内键仅在主窗口聚焦时由 keydown 捕获。两类按键的动作统一走 PET_ACTIONS，
// 与手势共用 petCtx，不再维护独立的 shortcutActions 映射。
```

- [ ] **Step 4: 重写 `applyShortcuts` → `applyTriggerBindings` 与 `onAppShortcutKeydown`**

把 `:485-539`（原 `appShortcutMap` 声明 + `applyShortcuts` + `onAppShortcutKeydown`）整段替换为：

```ts
/** 当前生效的应用内快捷键：按键串 → TriggerBinding。每次应用时重建。 */
let appKeyMap: Record<string, TriggerBinding> = {};

/**
 * 按 entry 的 actionId 分发动作；统一走 PET_ACTIONS，与手势共用 petCtx。
 * 对 togglePassthrough 补一次 toast，保持与迁移前独立实现一致。
 */
function dispatchKeyBinding(entry: TriggerBinding): void {
  const action = PET_ACTIONS[entry.actionId] ?? PET_ACTIONS.none;
  action(petCtx);
  if (entry.actionId === "togglePassthrough") {
    showToast(passthrough.value ? "已开启穿透" : "已关闭穿透");
  }
}

/**
 * 按最新配置（重新）应用全部快捷键：
 * 1) 注销此前注册的全部全局键；
 * 2) 逐条注册全局键，注册失败（多半被其他程序占用）记入 failedIds；
 * 3) 重建应用内键查找表，交由窗口 keydown 监听匹配；
 * 4) 把 failedIds 回传给设置窗，用于标红提示。
 * 手势侧由 useGestures 直接读 triggerBindings，无需在此处理。
 */
async function applyTriggerBindings() {
  // 全局键：先清空我们注册过的全部全局键，再逐条注册。
  try {
    await unregisterAll();
  } catch {
    // 忽略——可能此前未注册过任何全局键。
  }

  const failedIds: string[] = [];
  appKeyMap = {};

  for (const entry of triggerBindings.value) {
    if (entry.kind !== "key" || !entry.trigger) continue;
    if (entry.isGlobal) {
      try {
        // 注册时绑定回调；按下（而非松开）时触发一次。
        await register(toAccelerator(entry.trigger), (e) => {
          if (e.state === "Pressed") dispatchKeyBinding(entry);
        });
      } catch {
        // 注册失败＝该组合键已被其他程序占用，系统层无法抢占，记下供前端提示。
        failedIds.push(entry.id);
      }
    } else {
      appKeyMap[entry.trigger] = entry;
    }
  }

  // 回传注册结果给设置窗（若其打开着），用于标记被占用的全局键。
  emit(TRIGGER_BINDINGS_RESULT_EVENT, { failedIds } as TriggerResult).catch(() => {});
}

/** 窗口级 keydown：匹配应用内快捷键。仅主窗口聚焦时触发，故不与其他软件全局冲突。 */
function onAppShortcutKeydown(e: KeyboardEvent) {
  for (const key in appKeyMap) {
    if (matchesKey(e, key)) {
      e.preventDefault();
      dispatchKeyBinding(appKeyMap[key]);
      return;
    }
  }
}
```

- [ ] **Step 5: 更新 onMounted / 监听调用点**

在 onMounted 中，原 `applyShortcuts();`（:571）改为 `applyTriggerBindings();`。
原 `unlistenShortcuts = await listen(SHORTCUTS_CHANGED_EVENT, () => { applyShortcuts(); });`（:582-585）改为：

```ts
    unlistenShortcuts = await listen(TRIGGER_BINDINGS_CHANGED_EVENT, () => {
      // 设置窗保存后广播新绑定；主窗刷新本地 ref 并重新应用。
      triggerBindings.value = loadTriggerBindings();
      applyTriggerBindings();
    });
```

> 需在 import 里加 `loadTriggerBindings`：把 Step 1 的 useTriggerBindings import 块补上 `loadTriggerBindings,`。
> 确认 `listen` 已 import（Pet.vue 原有）。

- [ ] **Step 6: 类型检查（Task 3 + Task 4 一起）**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: `Pet.vue` 与 `useGestures.ts` 均无错。可能仍有 `DisplaySettings.vue` / `ShortcutSettings.vue` 报错（Task 5/6 修）。

- [ ] **Step 7: Commit（Task 3 + Task 4 合并）**

```bash
git add src/composables/useGestures.ts src/components/Pet/Pet.vue
git commit -m "refactor: 手势引擎与主窗分发改读统一 TriggerBinding[]"
```

---

## Task 5: `SettingsApp.vue` 删 shortcuts 导航项、改标签

**Files:**
- Modify: `src/settings/SettingsApp.vue:44`（KeepAlive 分支）
- Modify: `src/settings/SettingsApp.vue:60`（import）
- Modify: `src/settings/SettingsApp.vue:77`（navItems 标签）
- Modify: `src/settings/SettingsApp.vue:80`（navItems 删 shortcuts 行）

> 本任务与 Task 6 一起提交（ShortcutSettings.vue 仍存在会类型不过）。

- [ ] **Step 1: 改导航标签 `显示设置` → `显示与交互`**

`src/settings/SettingsApp.vue:77`：

```ts
  { key: "display", label: "显示与交互", icon: "🖥️" },
```

- [ ] **Step 2: 删除 shortcuts 导航项**

删除 `src/settings/SettingsApp.vue:80` 整行：

```ts
  { key: "shortcuts", label: "快捷键设置", icon: "⌨️" },
```

- [ ] **Step 3: 删除 KeepAlive 中 shortcuts 分支**

删除 `src/settings/SettingsApp.vue:44` 整行：

```vue
        <ShortcutSettings v-else-if="activeKey === 'shortcuts'" />
```

- [ ] **Step 4: 删除 import**

删除 `src/settings/SettingsApp.vue:60` 整行：

```ts
import ShortcutSettings from "./ShortcutSettings.vue";
```

- [ ] **Step 5: 暂不单独提交**，继续 Task 6。

---

## Task 6: `DisplaySettings.vue` 合并触发器卡片 + 实时冲突探测；删 `ShortcutSettings.vue` + `useGestureConfig.ts` + `useShortcuts.ts`

**Files:**
- Modify: `src/settings/DisplaySettings.vue`（整段重写点击设置 + 快捷键两卡片 → 单一触发器卡片）
- Delete: `src/settings/ShortcutSettings.vue`
- Delete: `src/composables/useGestureConfig.ts`
- Delete: `src/composables/useShortcuts.ts`

**Interfaces:**
- Consumes: `loadTriggerBindings`、`saveTriggerBindings`、`DEFAULT_TRIGGER_BINDINGS`、`TRIGGER_BINDINGS_CHANGED_EVENT`、`TRIGGER_BINDINGS_RESULT_EVENT`、`TriggerResult`、`TriggerBinding`、`serializeKeyEvent`、`matchesKey`、`toAccelerator`、`formatKey`（from useTriggerBindings）；`ACTION_LABELS`、`GESTURE_ACTION_KEYS`、`SHORTCUT_ACTION_KEYS`、`MOUSE_TRIGGER_LABELS`（from usePetActions）；`register`/`unregister`（from global-shortcut，探测用）

> 注意：`DisplaySettings.vue` 现有 import 了 `gestureConfig`/`saveGestureConfig`（from useGestureConfig）——本任务删除该 import，改用 useTriggerBindings。

- [ ] **Step 1: 替换 `DisplaySettings.vue` 的「🖱️ 点击设置」整张卡片为统一「触发器」卡片**

把 `src/settings/DisplaySettings.vue` 模板中从 `<!-- 手势配置：...` 注释所在的 `<el-card>` 开始，到该卡片 `</el-card>` 结束（约 :65-205），整段替换为：

```vue
      <!-- 触发器配置：鼠标手势 + 键盘快捷键合并为一张表。
           前4行鼠标（触发只读、仅改动作），后续快捷键行（录制/动作/全局开关/删除）。
           全局键编辑时实时探测占用，冲突即报红；保存后才持久化并广播生效。 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="display-settings__card-header">
            <span class="display-settings__card-title">🖱️ 触发器</span>
            <el-button type="primary" text :icon="Plus" @click="addKeyBinding">
              新增快捷键
            </el-button>
          </div>
        </template>

        <div class="trigger-list">
          <div
            v-for="(b, i) in rows"
            :key="b.id"
            class="trigger-row"
            :class="{ 'trigger-row--mouse': b.kind === 'mouse' }"
          >
            <!-- 触发方式 -->
            <div v-if="b.kind === 'mouse'" class="trigger-row__mouse-label">
              {{ MOUSE_TRIGGER_LABELS[b.trigger] ?? b.trigger }}
            </div>
            <div
              v-else
              class="trigger-row__input"
              :class="{
                'trigger-row__input--recording': recordingIndex === i,
                'trigger-row__input--conflict':
                  conflictIds.has(b.id) || externalIds.has(b.id),
              }"
              :title="
                externalIds.has(b.id) ? '该组合键可能被其他程序占用，请更换' : ''
              "
              tabindex="0"
              @keydown.prevent.stop="(e) => onKeydown(e, i)"
              @focus="recordingIndex = i"
              @blur="recordingIndex = -1"
            >
              <span v-if="recordingIndex === i" class="recording-hint">
                按键盘设置快捷键
              </span>
              <template v-else-if="b.trigger">{{ formatKey(b.trigger) }}</template>
              <span v-else class="placeholder">点击输入快捷键</span>
              <el-button
                v-if="b.trigger && recordingIndex !== i"
                text
                :icon="Close"
                class="clear-btn"
                @click.stop="clearKey(i)"
              />
            </div>

            <!-- 动作下拉 -->
            <el-select
              v-model="b.actionId"
              class="trigger-row__action"
              @change="checkConflicts"
            >
              <el-option
                v-for="key in actionKeysFor(b.kind)"
                :key="key"
                :label="ACTION_LABELS[key] ?? key"
                :value="key"
              />
            </el-select>

            <!-- 作用域（仅快捷键） -->
            <el-segmented
              v-if="b.kind === 'key'"
              v-model="b.isGlobal"
              :options="scopeOptions"
              @change="() => onScopeChange(i)"
            />

            <!-- 删除（仅快捷键） -->
            <el-button
              v-if="b.kind === 'key'"
              text
              :icon="Delete"
              @click="removeBinding(i)"
            />
          </div>
        </div>

        <div class="hint-block">
          <p>💡 前 4 行为鼠标手势，触发方式固定，仅可改动作。</p>
          <p>💡 点击按键框后按下组合键即可绑定，按 Backspace 清空。</p>
          <p>🌐 全局键在任何程序活跃时都生效，可能与其他软件冲突；冲突会标红，换一个即可。</p>
          <p>🏠 应用内键仅在桌宠主窗口聚焦时生效。</p>
          <p>修改后请点底部「保存」生效。</p>
        </div>

        <div class="display-settings__trigger-actions">
          <el-button :icon="Refresh" @click="resetDefaults">恢复默认</el-button>
          <el-button type="primary" :icon="Check" @click="save">保存</el-button>
        </div>
      </el-card>
```

- [ ] **Step 2: 替换 `DisplaySettings.vue` 的 `<script setup>` import 区**

把 `src/settings/DisplaySettings.vue:213-233` 的 import 区替换为：

```ts
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import {
  size,
  opacity,
  alwaysOnTop,
  passthrough,
  broadcast,
  saveAndBroadcast,
} from "../composables/useDisplaySettings";
import {
  loadTriggerBindings,
  saveTriggerBindings,
  DEFAULT_TRIGGER_BINDINGS,
  TRIGGER_BINDINGS_CHANGED_EVENT,
  TRIGGER_BINDINGS_RESULT_EVENT,
  serializeKeyEvent,
  formatKey,
  toAccelerator,
  type TriggerBinding,
  type TriggerResult,
} from "../composables/useTriggerBindings";
import {
  ACTION_LABELS,
  GESTURE_ACTION_KEYS,
  SHORTCUT_ACTION_KEYS,
  MOUSE_TRIGGER_LABELS,
} from "../composables/usePetActions";
import { Setting, Plus, Refresh, Check, Close, Delete } from "@element-plus/icons-vue";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { ElMessage } from "element-plus";
import PhraseConfigDialog from "./PhraseConfigDialog.vue";
import MenuConfigDialog from "./MenuConfigDialog.vue";
```

- [ ] **Step 3: 替换 script 中的手势配置逻辑为触发器逻辑**

把 `src/settings/DisplaySettings.vue` 原 `:245` 附近的 `const actionKeys = GESTURE_ACTION_KEYS;` 之后到 `onGestureChange` 函数结束（约 :245-303）的整段，替换为以下（保留 `actionKeys` 之上的格式化函数与 phraseDialogVisible/menuDialogVisible 等已有声明）：

```ts
/** 可在手势配置中绑定的所有动作 key。 */
const actionKeys = GESTURE_ACTION_KEYS;

// ── 触发器（鼠标手势 + 快捷键） ────────────────────────────────
/** 触发器可编辑行（基于 TriggerBinding，id 复用）。 */
const rows = ref<TriggerBinding[]>([]);
const recordingIndex = ref(-1);
/** 内部冲突：同一组合键绑给了多条快捷键。 */
const conflictIds = ref<Set<string>>(new Set());
/** 外部冲突：全局键被其他程序占用（实时探测 + 主窗回传）。 */
const externalIds = ref<Set<string>>(new Set());

let unlistenResult: UnlistenFn | undefined;

/** 作用域分段控件选项。`el-segmented` 的 value 用 boolean 绑 isGlobal；
 *  若 vue-tsc 报类型不兼容，改用字符串 "app"/"global" 并在读写处转换。 */
const scopeOptions = [
  { label: "🏠 应用内", value: false },
  { label: "🌐 全局", value: true },
];

/** 按触发类型返回可绑动作白名单。 */
function actionKeysFor(kind: TriggerBinding["kind"]): string[] {
  return kind === "mouse" ? GESTURE_ACTION_KEYS : SHORTCUT_ACTION_KEYS;
}

/** 从共享模块加载配置，构建可编辑行。 */
function loadRows() {
  rows.value = loadTriggerBindings().map((b) => ({ ...b }));
  checkConflicts();
}

/**
 * 持久化并广播触发器变更，主窗收到后重新注册 / 应用。
 */
function save() {
  checkConflicts();
  if (conflictIds.value.size > 0) {
    ElMessage.warning("存在按键冲突，请先解决再保存");
    return;
  }
  saveTriggerBindings(rows.value.map((b) => ({ ...b })));
  emit(TRIGGER_BINDINGS_CHANGED_EVENT, rows.value.map((b) => ({ ...b }))).catch(
    () => {},
  );
  ElMessage.success("已保存");
}

/** 恢复为内置默认（尚未保存）。 */
function resetDefaults() {
  rows.value = DEFAULT_TRIGGER_BINDINGS.map((b) => ({ ...b }));
  externalIds.value = new Set();
  checkConflicts();
  ElMessage.info("已恢复默认（尚未保存）");
}

/** 新增一条空快捷键，默认应用内 / 无动作，自动进入录制。 */
function addKeyBinding() {
  rows.value.push({
    id: crypto.randomUUID(),
    kind: "key",
    trigger: "",
    actionId: "none",
    isGlobal: false,
  });
  recordingIndex.value = rows.value.length - 1;
  checkConflicts();
}

/** 删除指定快捷键行。 */
function removeBinding(index: number) {
  const id = rows.value[index]?.id;
  rows.value.splice(index, 1);
  if (id) {
    conflictIds.value.delete(id);
    externalIds.value.delete(id);
  }
  checkConflicts();
}

/** 检测并标记内部冲突（相同非空 key 的项）。 */
function checkConflicts() {
  const keyMap = new Map<string, string[]>();
  for (const b of rows.value) {
    if (b.kind !== "key" || !b.trigger) continue;
    const arr = keyMap.get(b.trigger) ?? [];
    arr.push(b.id);
    keyMap.set(b.trigger, arr);
  }
  const conflicts = new Set<string>();
  for (const [, ids] of keyMap) {
    if (ids.length > 1) for (const id of ids) conflicts.add(id);
  }
  conflictIds.value = conflicts;
}

/** 清空某项按键绑定。 */
function clearKey(index: number) {
  rows.value[index].trigger = "";
  externalIds.value.delete(rows.value[index].id);
  checkConflicts();
}

/**
 * 录制按键：序列化成 "Ctrl+Shift+A"。
 * Escape 取消录制；Backspace / Delete 清空；纯修饰键忽略。
 * 录制完成后若是全局键，立即探测占用。
 */
function onKeydown(e: KeyboardEvent, index: number) {
  if (e.key === "Escape") {
    recordingIndex.value = -1;
    (e.target as HTMLElement)?.blur();
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    clearKey(index);
    return;
  }
  const serialized = serializeKeyEvent(e);
  if (!serialized) return; // 纯修饰键，等待主键
  rows.value[index].trigger = serialized;
  externalIds.value.delete(rows.value[index].id);
  checkConflicts();
  recordingIndex.value = -1;
  // 全局键：录制完成立即探测占用。
  void probeAndMark(rows.value[index]);
}

/** 作用域切换：切到全局时立即探测占用。 */
function onScopeChange(index: number) {
  checkConflicts();
  const b = rows.value[index];
  if (b.kind === "key" && b.isGlobal) {
    void probeAndMark(b);
  } else {
    externalIds.value.delete(b.id);
  }
}

/**
 * 实时探测某条全局键是否被其他程序占用：尝试 register 成功后立即 unregister，
 * 不长期占用、不让草稿提前生效。失败则标红。
 */
async function probeAndMark(b: TriggerBinding): Promise<void> {
  if (b.kind !== "key" || !b.isGlobal || !b.trigger) return;
  const accel = toAccelerator(b.trigger);
  try {
    await register(accel, () => {});
    await unregister(accel);
    externalIds.value.delete(b.id);
  } catch {
    externalIds.value = new Set([...externalIds.value, b.id]);
    ElMessage.error("该组合键可能被其他程序占用，请更换");
  }
}

onMounted(async () => {
  loadRows();
  try {
    unlistenResult = await listen<TriggerResult>(
      TRIGGER_BINDINGS_RESULT_EVENT,
      (ev) => {
        externalIds.value = new Set(ev.payload?.failedIds ?? []);
        if (externalIds.value.size) {
          ElMessage.error("部分全局快捷键可能被其他程序占用（已标红），请更换");
        }
      },
    );
  } catch {
    // 忽略——事件绑定不可用。
  }
  // 让主窗按当前已保存配置应用一次并回传占用情况。
  emit(TRIGGER_BINDINGS_CHANGED_EVENT, rows.value.map((b) => ({ ...b }))).catch(
    () => {},
  );
});

onUnmounted(() => unlistenResult?.());
```

> 注意：原 `onGestureChange` / `phraseDialogVisible` / `menuDialogVisible` / `isPhraseAction` / `isMenuAction` 等若仍被模板使用（说话/菜单设置图标按钮），保留它们；仅删除与 `gestureConfig`/`saveGestureConfig` 相关的 `onGestureChange`。实现时以模板实际引用为准——本步替换区间是从 `const actionKeys` 到 `onGestureChange` 结束，不动其上下的其他声明。

- [ ] **Step 4: 在 `DisplaySettings.vue` `<style scoped>` 中补触发器样式**

在 `</style>` 前追加：

```css
.display-settings__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.trigger-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trigger-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.trigger-row__mouse-label {
  flex: none;
  width: 140px;
  font-weight: 600;
  font-size: 14px;
}

.trigger-row__input {
  flex: none;
  width: 140px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  outline: none;
}
.trigger-row__input:hover {
  border-color: var(--el-border-color-hover);
}
.trigger-row__input:focus,
.trigger-row__input--recording {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7);
}
.trigger-row__input--conflict {
  border-color: var(--el-color-danger);
  box-shadow: 0 0 0 1px var(--el-color-danger-light-7);
}

.trigger-row__action {
  flex: 1;
  min-width: 120px;
}

.placeholder {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.recording-hint {
  color: var(--el-color-primary);
  font-size: 13px;
}

.clear-btn {
  padding: 2px 4px;
  height: auto;
}

.display-settings__trigger-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
```

- [ ] **Step 5: 删除三个废弃文件**

```bash
git rm src/settings/ShortcutSettings.vue
git rm src/composables/useGestureConfig.ts
git rm src/composables/useShortcuts.ts
```

- [ ] **Step 6: 类型检查（全量）**

Run: `npx vue-tsc --noEmit`
Expected: 无输出（全部通过）。

- [ ] **Step 7: Commit（Task 5 + Task 6 合并）**

```bash
git add src/settings/SettingsApp.vue src/settings/DisplaySettings.vue
git commit -m "feat: 显示与交互页合并触发器卡片，支持动态增删改与实时冲突探测"
```

---

## Task 7: 手动验证 + 收尾

**Files:** 无代码改动

- [ ] **Step 1: 启动 Tauri dev**

Run: `pnpm app:dev`

- [ ] **Step 2: 迁移验证**

打开设置 → 显示与交互页触发器卡片。确认 7 条：4 鼠标（左键单击→戳一下并说话 / 双击→最小化 / 右键→打开菜单 / 长按→切换行为）+ 3 快捷键（Alt+Z 全局→最小化 / Alt+S 应用内→打开设置 / Alt+C 应用内→切换穿透）。
（本地若有旧 `pet-gesture-config` + `duoduo-shortcuts` localStorage，先确认迁移后正确，旧 boss-coming 迁成 minimize。）

- [ ] **Step 3: 鼠标动作改绑验证**

把「右键」动作改成「无」→ 保存 → 右键不再弹菜单。改回 → 保存 → 恢复。

- [ ] **Step 4: 快捷键增删改验证**

- 「新增快捷键」→ 空行自动录制 → 按组合键 → 选动作 → 选应用内 → 保存 → 主窗生效。
- 删除一条预置 → 保存 → 重开设置页确认已删。
- 「恢复默认」→ 7 条回归。

- [ ] **Step 5: 实时冲突探测验证**

- 录制一个已被系统/其他软件占用的全局键（如重复的 Alt+Z）→ 即时标红 + 提示。
- 切作用域到全局 → 即时探测。
- 保存时若仍占用 → 二次标红（主窗回传）。

- [ ] **Step 6: 老板来了语义验证**

Alt+Z（全局）→ 窗口最小化（minimize），符合「老板来了」语义。

- [ ] **Step 7: 手势回归验证**

左键单击 / 双击 / 右键 / 长按行为与改绑前一致（默认配置下）。

- [ ] **Step 8: 类型检查最终确认**

Run: `npx vue-tsc --noEmit`
Expected: 无输出。

- [ ] **Step 9: 提交验证修复（如有）**

若验证中发现并修复小问题则提交；否则无操作。
