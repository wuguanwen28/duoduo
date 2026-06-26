# 手势与快捷键统一触发器模型设计

> 日期：2026-06-26
> 主题：把「鼠标手势」与「键盘快捷键」合并为**单一触发器-动作绑定数组**。
> 每条绑定 = 触发方式 + 触发动作；快捷键类型额外有「是否全局」标志。
> 前 4 条为固定的鼠标点击行为，其后为可动态新增的快捷键。

## 背景与动机

原本手势与快捷键是两个独立系统（`useGestureConfig` 的手势对象 +
`useShortcuts` 的快捷键数组），各有一套数据模型与 UI。但二者本质都是
「触发器 → 动作」绑定，应当共用同一份数据、同一套 UI、同一套分发，
故合并为单一数组。

## 目标

- 手势 + 快捷键统一为 `TriggerBinding[]`，单一数据源。
- 鼠标 4 条（左键单击 / 双击 / 右键 / 长按）固定存在，仅可改动作，不可删/不可改触发方式。
- 快捷键可动态新增 / 删除，可录制按键、选动作、切全局/应用内。
- 动作统一复用 `PET_ACTIONS` 仓库，手势与快捷键共用分发。
- 现有手势配置与快捷键配置平滑迁移到统一数组，无丢失。
- 快捷键编辑时实时检测全局键占用，冲突即报红，无需等到保存。

## 非目标

- 不改外观设置（大小 / 透明度 / 层级 / 穿透）。
- 不新增 Tauri 后端命令。
- 不新增 `bossComing` 动作——「老板来了」就是最小化（`minimize`）的预置
  别名，直接复用 `minimize` 动作，不单列。
- 鼠标 4 个触发方式不可改、不可删（左键单击永远是左键单击）。

## 设计

### 1. 统一数据模型

新建 `src/composables/useTriggerBindings.ts`，承载统一模型；废弃
`useGestureConfig.ts` 与 `useShortcuts.ts` 的旧职责（见迁移）。

```ts
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
  /** 仅 kind=key 有效：是否系统层全局注册。mouse 恒为 app（不使用此字段）。 */
  isGlobal?: boolean;
}
```

**localStorage**：新 key `duoduo-trigger-bindings`，存 `{ entries: TriggerBinding[] }`。

**默认预置条目**（首次加载无任何配置时）：

| id            | kind  | trigger      | actionId          | isGlobal |
| ------------- | ----- | ------------ | ----------------- | -------- |
| m-leftClick   | mouse | leftClick    | pokeAndSpeak      | —        |
| m-doubleClick | mouse | doubleClick  | minimize          | —        |
| m-rightClick  | mouse | rightClick   | openMenu          | —        |
| m-longPress   | mouse | longPress    | wake              | —        |
| k-boss        | key   | Alt+Z        | minimize          | true     |
| k-settings    | key   | Alt+S        | openSettings      | false    |
| k-passthrough | key   | Alt+C        | togglePassthrough | false    |

（鼠标 4 条默认与原 `DEFAULT_GESTURE_CONFIG` 一致；快捷键 3 条与原
`SHORTCUT_DEFS` 一致，其中「老板来了」直接绑 `minimize`——它本就是
最小化的别名。）

### 2. 旧配置迁移

`loadTriggerBindings()` 读取时按优先级迁移：

1. 新格式（`{ entries: [...] }`）→ 直接用。
2. 旧手势配置 `pet-gesture-config`（`{leftClick,...}`）+ 旧快捷键
   `duoduo-shortcuts`（`{ "boss-coming": "Alt+Z", ... }` 或新格式 `{entries}`）
   同时存在 → 合并迁移：
   - 鼠标 4 条：从 `pet-gesture-config` 取 actionId，trigger 固定。
   - 快捷键：从 `duoduo-shortcuts` 取，旧裸对象格式按 id→actionId/scope 映射表转；
     新格式 `{entries}` 直接转（scope→isGlobal）。
   - 迁移后写回新 key `duoduo-trigger-bindings`，**不清除**旧 key（保留作回退，
     但后续读写只认新 key）。
3. 都没有 → 默认预置（不写盘）。

迁移幂等：读到新 key 即走分支 1，不再迁移。

**id→actionId / scope 映射表**（迁移旧快捷键用）：
`boss-coming→minimize/global`、`open-settings→openSettings/app`、
`toggle-passthrough→togglePassthrough/app`。
（旧 `boss-coming` 一律迁成 `minimize`，不再有独立的老板来了动作。）

### 3. 跨窗口同步

- 事件 `trigger-bindings-changed`：设置窗保存后广播 `TriggerBinding[]`，
  主窗收到后重新应用（重新注册全局键 + 重建 keydown 表 + 手势引擎读新动作）。
- 事件 `trigger-bindings-result`：主窗回传注册失败的快捷键 id 列表
  `failedIds`，设置窗据此标红。

### 4. 动作仓库

`usePetActions.ts`：

- **不新增** `bossComing` 动作（老板来了复用 `minimize`）。
- 新增 `SHORTCUT_ACTION_KEYS`：快捷键可绑白名单（不含 `startCalibrate`——
  仓库无实现）：
  `none / wake / poke / speak / pokeAndSpeak / openMenu / openSettings /
  minimize / toggleFollow / togglePassthrough / quit`
- `GESTURE_ACTION_KEYS`（鼠标可绑白名单）保留不动。
- 新增 `MOUSE_TRIGGER_LABELS`：鼠标触发方式的中文标签
  （`leftClick→"左键单击"`、`doubleClick→"左键双击"`、`rightClick→"右键"`、
  `longPress→"长按"`），供 UI 只读显示。
- `ACTION_LABELS` 保留现有；`minimize` 标签可用「最小化窗口」。

### 5. 手势引擎适配

`useGestures.ts` 现通过 `config.value.leftClick` 等命名属性读取动作。改为
接收 `bindings: Ref<TriggerBinding[]>`，内部按 trigger 查 mouse 项的
actionId：

```ts
function mouseAction(trigger: MouseTrigger): string {
  return bindings.value.find(b => b.kind === "mouse" && b.trigger === trigger)?.actionId ?? "none";
}
// 原 config.value.leftClick → mouseAction("leftClick")，余类推。
```

签名从 `useGestures(elRef, config, actions, ctx)` 改为
`useGestures(elRef, bindings, actions, ctx)`。

### 6. 主窗分发（Pet.vue）

- 删除独立 `shortcutActions` map。
- `petCtx` 抽成变量（原内联传给 useGestures 的对象字面量），手势与快捷键共用。
- `applyTriggerBindings`：遍历 `kind==="key"` 的条目，
  `isGlobal` 走 `register(accelerator)`，否则进 keydown 表；命中后
  `PET_ACTIONS[actionId](petCtx)`，找不到降级 `none`。
- `togglePassthrough` 动作执行后补 `showToast`（保持迁移前行为）。
- 手势侧：`useGestures(catWrapRef, triggerBindings, PET_ACTIONS, petCtx)`，
  引擎自己读 mouse 动作，Pet.vue 不再传 `gestureConfig`。

### 7. 快捷键编辑时实时冲突检测

设置窗在以下时机对**全局**快捷键做占用探测：录制完成、作用域切到全局、
动作变更后若仍为全局。

探测方式（设置窗内直接调用 `@tauri-apps/plugin-global-shortcut`）：

```ts
async function probeGlobalKey(key: string): Promise<boolean> {
  if (!key) return true;
  const accel = toAccelerator(key);
  try {
    await register(accel, () => {});   // 尝试注册
    await unregister(accel);           // 探测成功立即注销，不占用
    return true;
  } catch {
    return false;                      // 被其他程序占用
  }
}
```

- 探测失败 → 该条立即标红，提示「该组合键可能被其他程序占用，请更换」。
- 探测是瞬时的（register 后紧接 unregister），不干扰主窗已注册的全局键，
  也不提前让草稿生效。
- 保存时主窗正式注册，若仍失败经 `trigger-bindings-result` 二次回传标红
  （双保险，覆盖探测通过但保存瞬间被抢的窄窗口）。
- 应用内（非全局）键不做探测——它不进系统层，天然不与其他软件冲突。

### 8. UI（显示与交互页 · 触发器卡片）

**一张表，统一渲染 `TriggerBinding[]`：**

- 鼠标行（前 4 条，`kind==="mouse"`）：
  - 触发方式：只读标签（`MOUSE_TRIGGER_LABELS[trigger]`）。
  - 动作：`el-select` 绑 `actionId`，options 来自 `GESTURE_ACTION_KEYS`。
  - 无作用域开关、无删除按钮。
- 快捷键行（`kind==="key"`）：
  - 触发方式：录制按键框（聚焦录制，Escape 取消，Backspace 清空，冲突标红）。
  - 动作：`el-select` 绑 `actionId`，options 来自 `SHORTCUT_ACTION_KEYS`。
  - 作用域：`el-segmented` 全局🌐 / 应用内🏠，绑 `isGlobal`。
  - 删除按钮。
- 底部「＋ 新增快捷键」：追加一条 `{ id: crypto.randomUUID(), kind: "key",
  trigger: "", actionId: "none", isGlobal: false }`，自动进入录制。

**实时检测**：快捷键行的按键录制完成或作用域切到全局时，立即触发
`probeGlobalKey`；失败标红 + 提示。

**保存**：显式「保存」按钮才持久化 + 广播（非实时）。保存前校验内部按键冲突，
有冲突则提示且不保存。

**恢复默认**：重置为 7 条预置（4 鼠标 + 3 快捷键，未保存）。

**冲突标记**：`conflictIds`（内部同 key）+ `externalIds`（全局被占用，含
实时探测失败 + 主窗回传失败）。

页面标题「显示设置」→「显示与交互」；删除独立「快捷键设置」导航项。

### 9. 文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src/composables/useTriggerBindings.ts` | **新建**：统一模型 + 迁移 + 广播 + 按键序列化（从 useShortcuts 迁入） |
| `src/composables/usePetActions.ts` | 加 `SHORTCUT_ACTION_KEYS`、`MOUSE_TRIGGER_LABELS`（不加 bossComing） |
| `src/composables/useGestures.ts` | 改读 `TriggerBinding[]`，签名改 `bindings` |
| `src/composables/useGestureConfig.ts` | **删除**（职责并入 useTriggerBindings） |
| `src/composables/useShortcuts.ts` | **删除**（职责并入 useTriggerBindings） |
| `src/components/Pet/Pet.vue` | 抽 `petCtx`、删 `shortcutActions`、`applyTriggerBindings`、手势改传 `triggerBindings` |
| `src/settings/DisplaySettings.vue` | 改标题，点击设置卡片 + 快捷键卡片 → **合并为单一「触发器」卡片**，加实时冲突检测 |
| `src/settings/ShortcutSettings.vue` | **删除** |
| `src/settings/SettingsApp.vue` | 删 shortcuts 导航项、改标签 |

**不改动**：`useDisplaySettings.ts` / `src-tauri/**`。

## 边界与风险

1. **鼠标 4 条不可删**：UI 渲染时 `kind==="mouse"` 行不显示删除按钮；迁移/默认
   保证始终有这 4 条。
2. **`navigate-to` 事件**：Rust 端发任意 tab，删 shortcuts 导航项不影响。
3. **迁移幂等**：读到新 key `duoduo-trigger-bindings` 即直接用，不再迁移。
4. **原 boss-coming 全局键**：迁移为 `minimize`，保留 isGlobal=true；用户可改应用内。
5. **未知 actionId**：降级 `PET_ACTIONS.none`，不崩。
6. **手势引擎读不到 mouse 项**：`mouseAction` 返回 `"none"`，降级空操作。
7. **探测与主窗注册竞态**：探测瞬时完成（register 后立即 unregister），
   不长期占用；保存时主窗注册失败有 result 事件二次兜底。
8. **类型检查**：`vue-tsc --noEmit` 须通过。

## 验证

- 旧手势配置 + 旧快捷键配置加载后自动迁移为统一数组，7 条正确对应
  （boss-coming 迁成 minimize）。
- 鼠标 4 条改动作后主窗即时生效（保存后）。
- 快捷键新增 / 删除 / 改键 / 改作用域 / 改动作，保存后主窗即时生效。
- 录制全局键时若被其他程序占用，**即时**标红提示；保存时若仍占用二次标红。
- 应用内键不探测、不冲突。
- 原 Alt+Z 全局键触发窗口最小化（minimize），行为符合「老板来了」语义。
- 手势（左键单击 / 双击 / 右键 / 长按）无回归。
- `vue-tsc --noEmit` 通过。
