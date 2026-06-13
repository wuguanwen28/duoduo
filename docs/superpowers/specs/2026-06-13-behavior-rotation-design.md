# 行为轮换模型重构设计（behaviors + actions + 加权轮换）

日期：2026-06-13
状态：已通过头脑风暴评审，待写实现计划
关联：在 `2026-06-13-clips-behaviors-design.md`（片段+行为）基础上演进

## 1. 背景与动机

当前模型用 `idleAuto`（idle 时随机自动播一个行为）+ `autoEndMs`（循环行为自动结束）两个特例来制造"待机时偶尔做点事、睡一会自动醒"。问题：

- 这是**特例堆叠**，不统一：idle 是"家"，其它行为是"客串"，sleep 还要单独的自动结束时长。
- 想加 walk（走路）这类平级行为时，没有一致的轮换 / 转场机制。
- 手动触发（菜单"投喂"）和自动行为是两套路径。

**目标**：把所有"自治行为"做成**平级**，按各自**权重 + 时长**随机轮换；跨行为切换统一走"离开者的 exit → 进入者的 enter"转场；手动触发（投喂/wiki）作为**归属某行为的一次性动作**纳入同一套转场规则。去掉 `idleAuto`、`autoEndMs`。

## 2. 三层概念

```
CLIPS      —— 最小动画片段（不变：src/range/fps/yoyo），见 clips.ts
BEHAVIORS  —— 自治行为：idle / sleep /（将来 walk）。有 loop + 时长 + 权重，参与随机轮换
ACTIONS    —— 手动一次性动作：feed / wiki。归属某个行为，触发时切到该行为、播一次片段、留下
```

## 3. 数据结构

### 3.1 Behavior

```ts
interface BehaviorLoop {
  base: string;          // 基底片段名（呼吸）
  random: string[];      // 随机插播片段名（含 feed/wiki 这类，做环境随机）
  delay: [number, number]; // 两次插播随机间隔(ms)
}

interface Behavior {
  enter?: string;        // 进入时播一次的片段名（sleep: lieDown；idle: 无）
  loop: BehaviorLoop;    // 自治行为必有 loop（轮换期间持续播放）
  exit?: string;         // 离开时播一次的片段名（sleep: wakeUp；idle: 无）
  weight: number;        // 轮换被选中的相对权重（idle 高、sleep 低）
  duration: [number, number]; // 本行为持续多久(ms) 后触发下一次轮换，随机区间
  interruptible?: boolean;    // 鼠标移动能否抢占进 follow，默认 false
}
```
**去掉** `idleAuto`、`autoEndMs`、以及旧的"无 loop ＝ 一次性行为"用法（一次性改由 ACTIONS 表达）。

### 3.2 Action

```ts
interface ActionDef {
  home: string;  // 归属行为名（feed/wiki → 'idle'）
  clip: string;  // 要播放的片段名
}
```

### 3.3 当前内容

```ts
const BEHAVIORS: Record<string, Behavior> = {
  idle: {
    loop: { base: "idleBreathe", random: ["idleBlink", "idleTail", "idleEar", "feed", "wiki"], delay: [5000, 11000] },
    weight: 10,                 // 大部分时间待机
    duration: [15000, 40000],
    interruptible: true,        // 鼠标移动可进 follow
  },
  sleep: {
    enter: "lieDown",
    loop: { base: "sleepBreathe", random: ["sleepEar", "sleepTail"], delay: [3000, 7000] },
    exit: "wakeUp",
    weight: 2,                  // 偶尔睡
    duration: [60000, 120000],  // 睡 1–2 分钟（取代 autoEndMs）
    interruptible: false,       // 鼠标移动不打断，只能点击/时长到
  },
  // walk: 将来加，需 cat-walk 素材
};

const ACTIONS: Record<string, ActionDef> = {
  feed: { home: "idle", clip: "feed" },
  wiki: { home: "idle", clip: "wiki" },
};
```

> 注：`feed`/`wiki` 既在 `idle.loop.random` 里做环境随机（待机时偶尔吃一下/wiki 一下），又登记在 `ACTIONS` 里供菜单手动触发。两处含义不同（环境随机 vs 手动），各自登记。

## 4. 自治轮换（替代 idleAuto + autoEndMs）

`useCatBrain` 持有"轮换定时器"。进入某行为并开始 loop 时，按该行为 `duration` 区间取一个随机时长排定时器。到点（且未在 follow、未暂停）：

1. 按所有行为的 `weight` 加权随机挑下一个行为名 `next`。
2. 若 `next === 当前` → 不转场，仅重排时长定时器（高权重的 idle 自然就"多待一会"）。
3. 否则**转场**：播当前行为 `exit` → 播 `next.enter` → 进 `next.loop` → 按 `next.duration` 重排定时器。

权重让"大部分时间 idle、偶尔 sleep"自然成立，无需把 idle 特殊化。

## 5. follow（抢占层，不参与轮换）

- 鼠标移动、光标在头部死区外、且**当前行为 `interruptible`** → 立即切 follow（不播 exit，保证跟随不滞后）。`sleep.interruptible=false` 不被抢占。
- follow 期间**暂停轮换定时器**。
- 鼠标静止超 `idleTimeoutMs` 或进死区或关闭跟随 → 回 **idle**（idle.enter→loop），轮换重启。

## 6. 手动触发 trigger(name)

`name` 先查 `BEHAVIORS`，再查 `ACTIONS`：

- **是行为**（sleep）：若已是当前行为则忽略；否则播当前 `exit` → `start(该行为)`（enter→loop），按其 duration 排定时器、参与后续轮换。
- **是动作**（feed）：`home = ACTIONS[name].home`；
  - 若当前行为 ≠ home：播当前 `exit` → `start(home, { lead: ACTIONS[name].clip })`；
  - 若当前已是 home：直接 `start(home, { lead: clip })`（无 exit/enter 视觉，仅重置 loop）；
  - `lead` 含义见 §7：home 的 enter 之后、loop 之前，先把该动作片段播一次，然后留在 home 的 loop。
- `name` 两表都没有 → 空操作。

例：睡觉时点投喂 → 播 `wakeUp`(sleep.exit 起床) → `start(idle, {lead:"feed"})`：idle 无 enter → 播 feed 一次 → 进 idle loop。符合"先起床再吃，吃完留在 idle"。

## 7. 引擎 useBehavior 的调整

现有 `useBehavior` 已能 enter→loop、`requestExit(onDone)` 播 exit→回调、`canWake()`。调整：

- **`start(behavior, opts?: { lead?: string })`**：流程变为 `enter?` → `lead?`（一次性片段，可选）→ `loop`。`lead` 用于动作（feed）。
- **移除** `start` 的 `onAutoEnd` 参数与内部 `autoEndMs` 定时器（时长/结束改由 brain 的轮换定时器驱动）。所有行为都有 loop，不再有"无 loop 直接 requestExit"分支。
- `requestExit(onDone)` / `stop()` / `canWake()` 保留。转场靠 brain 串联：`beh.requestExit(() => beh.start(next, opts))`。
- `lead` 片段按离散片段播放（`resolveClip` + 一次性播放器），播完进 loop；与 enter 同机制。

## 8. 状态机简化（useCatBrain）

状态从 `idle | follow | action` 收敛为 `follow | behavior`：

- **behavior**：正在运行某自治行为，`currentBehavior: string` 记录是哪个（idle/sleep）。idle 与 sleep 都是 behavior 状态，区别只在 `currentBehavior`。
- **follow**：光标跟随。

tick 逻辑：
- `behavior`：若 `moved && following && angle!==null && BEHAVIORS[currentBehavior].interruptible` → enterFollow。（轮换由独立定时器驱动，不在 tick 里。）
- `follow`：若 `!following` 或静止超时或 `angle===null`（进死区）→ 回 idle 行为；否则 `gaze.update(angle)`。
- `paused`（校准）：保持 idle、暂停轮换、忽略光标（同现状）。

**点击唤醒 wake()**：仅当当前行为**有 exit** 且 `canWake()`（已进 loop）时，播该 exit → 回 idle。点击睡觉中的猫 → 起床回 idle；点击 idle（无 exit）→ 无效。一次性动作的 `lead` 播放期间 `canWake()` 为 false（未进 loop），点击被忽略（须播完）。

## 9. 菜单 / 触发接线

- 菜单"😴 睡觉" → `trigger("sleep")`。
- 菜单"🍗 投喂" → `trigger("feed")`。
- 后端 `pet-play-action` 事件 → `trigger(payload)`（payload 可为行为名或动作名）。

## 10. 文件改动

| 文件 | 改动 |
|---|---|
| `src/actions/behaviors.ts` | 重写：`Behavior`（加 weight/duration，去 idleAuto/autoEndMs）、`ACTIONS` 表、`BEHAVIORS`（idle/sleep）。`IDLE_POOL` 删除（轮换取代） |
| `src/actions/clips.ts` | 不变（feed/wiki/idle 各片段已在） |
| `src/composables/useBehavior.ts` | `start` 加 `lead`、去 `onAutoEnd`/autoEndMs；其余保留 |
| `src/composables/useCatBrain.ts` | 重写状态机：behavior/follow 两态、currentBehavior、加权轮换定时器、转场串联、trigger 双查 BEHAVIORS/ACTIONS、wake 改为"有 exit 才唤醒到 idle"。`BrainConfig` 移除 `idlePool`/`idleActionDelay`（被行为的 weight/duration 取代），保留 `tickMs`/`moveThreshold`/`idleTimeoutMs` |
| `src/components/Pet/Pet.vue` | onFeed → `trigger("feed")`（去掉 resume 参数语义）；onSleep → `trigger("sleep")` |

## 11. 边界与注意点

- **轮换 vs follow 竞态**：follow 期间暂停轮换定时器；回 idle 时重排。
- **转场期间再次触发**：转场是 `requestExit→start` 链；其间用 `exiting` 幂等守卫（引擎已有）避免重入；brain 侧在转场未完成时忽略新的自动轮换（但允许手动 trigger 打断？——默认手动 trigger 也走 requestExit，若正在 exit 则被幂等吞掉；可接受）。
- **lead 与 canWake**：lead 播放阶段不可唤醒（未进 loop），符合"动作要播完"。
- **walk 缺素材**：暂不加 walk 行为；模型已支持，加 cat-walk 片段 + 一条 behavior 即可。
- **权重/时长均为大概值**，后续手感微调。

## 12. 验证方式（无测试运行器）

`pnpm build`（vue-tsc）+ `pnpm app:dev` 手动观察：
1. 待机大部分时间 idle（呼吸 + 偶尔眨眼/摇尾巴/动耳朵/吃/wiki）。
2. 偶尔自动进入 sleep（趴下→熟睡→1–2 分钟后起身→回轮换）。
3. 菜单睡觉/投喂：投喂时若在睡觉先起床再吃、吃完留 idle。
4. 鼠标移动（死区外）抢占进 follow；睡觉时鼠标移动不打断；点击睡觉中的猫起身。
5. 光标进头部死区 → 回 idle。

## 13. 不在本次范围

- walk 行为（缺素材）。
- 逐帧精修片段区间、权重/时长手感（先给默认值）。
- feed/wiki 与 idle 不同源的丝滑（离散播放，靠首尾同姿态过渡，可接受）。
</content>
