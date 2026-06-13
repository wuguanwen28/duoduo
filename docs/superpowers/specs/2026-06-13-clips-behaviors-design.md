# 片段（Clips）+ 行为（Behaviors）重构设计

日期：2026-06-13
状态：已通过头脑风暴评审，待写实现计划
取代：`docs/superpowers/specs/2026-06-12-segmented-action-design.md`（旧的双注册表/分段方案）

## 1. 背景与动机

现状有**两套并存的动作配置**，理解成本高：

- `src/actions/index.ts` 的 `ACTIONS`（`ActionDef`）—— 老的一次性/循环动作 + 元数据。
- `src/actions/segments.ts` 的 `SegmentedActionDef` —— 新的分段播放配置（sleep、idle）。

后果：**sleep 要在两处各登记一遍**（`ACTIONS` 里给 `idle:true`/`interruptible`，`SEGMENTED_ACTIONS` 里给真正的播放），`trigger(name)` 还要按"先查分段表、再查老表"的顺序解析。新人难懂。

第二个问题是**拼接跳帧**：分段运行器把每个段当独立数组，循环时基底从自己第 1 帧重启、插播从自己第 1 帧开始；而 sleep 的呼吸/耳朵/尾巴在原录像里本是**连续相邻**的帧，硬切就会跳帧（例如呼吸停在 192，插播硬跳到 200）。

## 2. 目标

1. **一套**声明式模型：先定义所有「片段」（最小动画单元，各带 帧/fps/yoyo），再定义「行为」（像剧本一样按名字引用片段）。
2. **干掉双注册表**：一个行为一条；`idle`/`sleep`/`wiki` 全统一为行为；sleep 不再登记两遍。
3. **丝滑链**：同源且接缝相邻的片段之间无跳帧续播（呼吸↔耳朵↔尾巴）。
4. 方向藏进区间：`range:[0,190]` 正放、`range:[190,0]` 倒放；取消 `reverse` 参数。
5. 区间/速度仍是集中常量，便于逐帧微调。

## 3. 模型

### 3.1 帧来源 SOURCES

把来源名映射到帧数组（来自 `src/actions/frames.ts`）：

```ts
const SOURCES: Record<string, string[]> = {
  sleep: FRAMES.sleep,   // cat-sleep（241 帧 0..240）
  idle:  IDLE_FRAMES,    // cat-idla
  wiki:  FRAMES.wiki,    // cat-wiki
};
```

### 3.2 片段 Clip

```ts
interface Clip {
  /** 帧来源键（SOURCES 的键）。 */
  src: string;
  /**
   * 帧区间 [a, b]，左闭右开，方向即播放方向：
   *   a <= b ：正放，帧 a..b-1（slice(a,b)）
   *   a >  b ：倒放，帧 a-1..b（slice(b,a).reverse()）
   * 例：lieDown=[0,190] 正放 0..189；wakeUp=[190,0] 倒放 189..0（即 lieDown 反过来）。
   */
  range: [number, number];
  /** 播放速度（fps）。 */
  fps: number;
  /** yoyo 来回（正放+反放，去重端点），默认 false。 */
  yoyo?: boolean;
  /** 可读标签（调试/中文名）。 */
  label?: string;
}
```

**片段 → 帧数组解析**（运行器内）：
```
resolveClip(clip):
  src = SOURCES[clip.src]
  [a, b] = clip.range
  seq = a <= b ? src.slice(a, b) : src.slice(b, a).reverse()
  if clip.yoyo && seq.length > 2: seq = [...seq, ...seq.slice(1, -1).reverse()]
  return seq
```

**片段库 CLIPS（端点为大概值，待逐帧微调）：**
```ts
const CLIPS = {
  lieDown:      { src:'sleep', range:[0,190],   fps:36, label:'趴下' },
  wakeUp:       { src:'sleep', range:[190,0],   fps:36, label:'醒来' },        // 趴下倒放
  sleepBreathe: { src:'sleep', range:[187,200], fps:10, yoyo:true, label:'睡觉呼吸' },
  sleepEar:     { src:'sleep', range:[200,215], fps:24, label:'睡觉耳朵' },     // 从接缝出发
  sleepTail:    { src:'sleep', range:[200,241], fps:24, label:'睡觉尾巴' },     // 从接缝出发，走更远
  idleBreathe:  { src:'idle',  range:[0, IDLE_LEN], fps:24, label:'空闲呼吸' }, // IDLE_LEN = IDLE_FRAMES.length
  wiki:         { src:'wiki',  range:[0, WIKI_LEN], fps:24, label:'wiki' },     // WIKI_LEN = FRAMES.wiki.length
} as const;
```

### 3.3 行为 Behavior

```ts
interface Behavior {
  /** 进入时正放一次的片段名（可选；一次性动作只配它）。 */
  enter?: string;
  /** 环境循环（可选；纯一次性动作不配）。 */
  loop?: {
    /** 基底片段名（呼吸等）。 */
    base: string;
    /** 随机插播的片段名列表（可空）。 */
    random: string[];
    /** 两次插播之间的随机间隔 [min,max]（毫秒）。 */
    delay: [number, number];
  };
  /** 退出时正放一次的片段名（可选；如 sleep 的 wakeUp）。 */
  exit?: string;
  /** 多少毫秒后自动结束（sleep 2 分钟自动醒）；不设＝不自动结束。仅对有 loop 的行为有意义。 */
  autoEndMs?: number;
  /** 鼠标移动能否打断并切回跟随，默认 false（默认不被鼠标打断，只能点击/自动结束）。 */
  interruptible?: boolean;
  /** 能否被空闲自动播放挑中，默认 false。 */
  idleAuto?: boolean;
}
```

**行为库 BEHAVIORS：**
```ts
const BEHAVIORS: Record<string, Behavior> = {
  idle: {
    loop: { base:'idleBreathe', random:[], delay:[6000,14000] },
    // idle 是「休息态」本身，不参与 idleAuto 自动挑选
  },
  sleep: {
    enter: 'lieDown',
    loop:  { base:'sleepBreathe', random:['sleepEar','sleepTail'], delay:[3000,7000] },
    exit:  'wakeUp',
    autoEndMs: 120000,
    // interruptible 默认 false：睡觉不被鼠标移动打断，只能点击/2 分钟自动醒
    idleAuto: true,
  },
  wiki: {
    enter: 'wiki',           // 只有 enter ＝ 一次性动作：放完即结束
    interruptible: true,     // wiki 可被鼠标移动打断（覆盖默认 false）
    idleAuto: true,
  },
};

/** 空闲自动播放池：idleAuto 为 true 的行为名。 */
const IDLE_POOL = Object.entries(BEHAVIORS).filter(([, b]) => b.idleAuto).map(([n]) => n);
```

**一次性 vs 循环**：没有 `loop` 的行为（wiki）＝放完 `enter`（再放 `exit` 若有）就 `finish`；有 `loop` 的行为（idle、sleep）进入循环，直到被唤醒/打断/自动结束。

## 4. 丝滑链（引擎自动，配置不操心）

核心：把同源相邻的片段当成「同一条连续录像」，用一个**播放头**（当前绝对帧索引 `cur`）沿原视频前后走，永不硬跳。

### 4.1 相邻判定

基底片段覆盖绝对帧索引区间 `[baseLo, baseHi]`（如 sleepBreathe `[187,200]` → 187..199，baseHi=199）。
一个插播片段与基底**丝滑相邻**的条件：`twitch.src === base.src` 且插播的起始绝对帧 `== baseHi + 1`（接缝相邻）。
（sleepEar/sleepTail 都从 200 起，200 == 199+1 → 相邻 ✅。）

### 4.2 丝滑插播（相邻时）

播放头在 `[baseLo, baseHi]` 间以 `baseFps` 来回摆动（呼吸）。当随机定时器到点（置 `pending`），**等播放头摆到 baseHi（接缝帧）那一刻**再出发，避免任何跳：

```
出去：cur 从 baseHi+1 逐帧 +1 走到 twitchHi（耳朵→214 / 尾巴→240），用该插播的 fps
回来：cur 从 twitchHi 逐帧 -1 走回 baseHi，再恢复呼吸摆动
```

全程 ±1 相邻帧 → 丝滑。插播"走多远"（twitchHi）天然区分耳朵/尾巴；插播自己的 `yoyo` 在相邻情形下被忽略（出去再回来本身就是 yoyo，锚在接缝而非第 1 帧）。

> 说明：尾巴 `[200,241]` 覆盖 200..240，出去会经过耳朵区，是符合真实连续运动的"更大幅度摆动"。

### 4.3 非相邻 / 不同源（兜底）

若插播不满足相邻条件（不同源，或起始帧 ≠ baseHi+1），无法续播，则**各播各的**：把该插播按 `resolveClip` 解析成数组、用它自己的 `yoyo` 整段播一次（硬切），播完回基底。等价于旧行为。idle 当前 `random:[]` 用不到，此为通用兜底。

### 4.4 enter / exit / 唤醒

- `enter`（lieDown）、`exit`（wakeUp）都是**离散片段**，用 `resolveClip` 整段播一次。
- 唤醒（点击/自动结束）：先停插播与定时器 → 若有 `exit` 则播一次（wakeUp＝lieDown 倒放，靠 range 方向实现）→ 回到 follow/idle。
- `autoEndMs` 与点击都走同一个"请求退出"，用幂等守卫避免重复。

## 5. 运行器（引擎）

`useBehavior`（取代 `useSegmentedAction`），对外：
```ts
interface BehaviorController {
  currentSrc: Ref<string>;
  start(b: Behavior, onAutoEnd?: () => void): void;  // enter → loop（含丝滑插播）
  requestExit(onDone: () => void): void;              // 停插播 → 播 exit（若有）→ onDone；幂等
  stop(): void;                                       // 硬停，不放 exit、不回调
}
```

内部用**播放头**驱动 loop：维护 `cur`（绝对帧）、`mode`（breatheUp/breatheDown/excursionOut/excursionBack）、以及一个按当前段 fps 计时的步进器（每步 +/−1 帧；fps 变化时调整步进间隔，用链式 `setTimeout` 而非固定 `setInterval`）。enter/exit/非相邻插播为离散整段播放（可复用现有 `useSpriteAnimation` 作为离散片段播放器，或在运行器内统一处理）。`onScopeDispose` 清理。

> 实现细节（步进器/复用 useSpriteAnimation 的边界）留待实现计划敲定；本设计只约定对外行为与配置模型。

## 6. 与 `useCatBrain` 整合

- 帧来源仍由 `activePlayer`（gaze / behavior）选择：follow 取 gaze，idle/动作取 `useBehavior` 的 `currentSrc`。（两套播放器合一后，可简化为 gaze / behavior 两路。）
- `enterIdle()` → `beh.start(BEHAVIORS.idle)`。
- `trigger(name)` → `beh.start(BEHAVIORS[name], finishAction)`，记录 `actionResume`；`name` 不存在则空操作。**不再有"先查分段表再查老表"的双路**。
- `wake()` → `beh.requestExit(finishAction)`。
- tick 的可打断判定读 `BEHAVIORS[name].interruptible`：默认 false，仅当显式为 `true`（如 wiki）时，鼠标移动才打断动作切回 follow（判定写成 `=== true`）。
- idle 自动播放从 `IDLE_POOL` 随机挑（`idleAuto` 的行为）。
- `pet-play-action` 事件仍转发到 `trigger(name)`。
- 卸载 `beh.stop()`。

idle 速度可继续用 `config.idleFps`：`beh.start({ ...BEHAVIORS.idle, loop:{ ...BEHAVIORS.idle.loop, ... } })` 或在 `idleBreathe` 片段上读配置——实现计划定。

## 7. 文件结构

| 文件 | 动作 |
|---|---|
| `src/actions/clips.ts` | 新增：`SOURCES`、`Clip` 类型、`CLIPS`、`resolveClip` |
| `src/actions/behaviors.ts` | 新增：`Behavior` 类型、`BEHAVIORS`、`IDLE_POOL` |
| `src/composables/useBehavior.ts` | 新增：播放头引擎（取代 `useSegmentedAction`） |
| `src/actions/segments.ts` | 删除（被 clips+behaviors 取代） |
| `src/composables/useSegmentedAction.ts` | 删除 |
| `src/actions/index.ts` | 删除 `ACTIONS`/`ActionDef`/`getAction`，或改为从 behaviors 再导出；`IDLE_POOL` 移到 behaviors.ts |
| `src/composables/useCatBrain.ts` | 改接 `useBehavior` + `BEHAVIORS` |
| `src/composables/useSpriteAnimation.ts` | 保留（可作离散片段播放器复用） |
| `src/actions/frames.ts` | 保留（提供 SOURCES 的帧数组） |

## 8. 边界与注意点

- **方向与覆盖**：`[0,190]` 与 `[190,0]` 覆盖同一帧集合 `{0..189}`、顺序相反；"调换两数"即反向。yoyo 与反向叠加：先按方向取序列，再 yoyo。
- **接缝出发时机**：插播必须等播放头到 baseHi 再出发，否则仍会跳；定时器到点只置 `pending`。
- **退出竞态**：`autoEndMs` 与点击都走 `requestExit`，幂等守卫只执行一次；退出时要能中断进行中的插播/步进器。
- **差一错误**：区间为大概值，实现按"左闭右开 + slice + 方向"统一敲定，避免 off-by-one。
- **baseHi 计算**：基底 `range:[a,b]`（a<b）的 baseHi = b-1；相邻插播起始帧应 = b。CLIPS 里 sleepBreathe `[187,200]` → baseHi=199，sleepEar/sleepTail 起始 200 ✓。
- **非相邻兜底**不丝滑是已知代价（当前 sleep 全相邻，不触发）。

## 9. 验证方式（无测试运行器）

`pnpm build`（含 `vue-tsc --noEmit`）+ `pnpm app:dev` 手动观察：
1. 触发睡觉 → 趴下（enter 正放一次）。
2. 熟睡：呼吸为底，每隔几秒随机耳朵/尾巴；**呼吸↔耳朵↔尾巴之间无跳帧**（重点验证丝滑）。
3. 点击 → 起身（wakeUp＝lieDown 倒放）后回 follow/idle。
4. 静置 2 分钟 → 自动起身。
5. idle 与改动前一致（整段循环）；wiki 一次性播放正常。

## 10. 不在本次范围

- 逐帧精修区间（先用大概值）。
- idle 的具体插播片段（以后往 `random` 填）。
- 多跳丝滑链（基底→A→B 自动串联）；当前用"插播从接缝出发、走更远"覆盖尾巴，无需多跳。
- 跨不同源的丝滑（无意义，直接硬切）。
</content>
