# 通用「分段动作」机制设计

日期：2026-06-12
状态：已通过头脑风暴评审，待写实现计划

## 1. 背景与动机

当前睡觉（sleep）动作的播放方式是：帧 `0–189` 作为「坐下→趴下」引导动画播放一次，随后靠 `useSpriteAnimation` 的 `loopFrom: 190` 把尾段 `190–240` 在 24fps 下**一刻不停地反复循环**。

存在两个问题：

1. **尾段循环太机械、频率太高** —— 51 帧每 ~2 秒转一圈、永不停歇，不像真猫熟睡。
2. **无法表达「偶尔抽动」的细分动作** —— 想做到「大部分时间安静呼吸，每隔几秒随机动一下耳朵 / 摇一下尾巴」，现有的单一 `loop/loopFrom` 表达不了。

此外，**idle（cat-idla）休息循环未来也需要同样的「基底 + 随机插播小动作」能力**。因此把「分段」抽成一个两个消费者（sleep + idle）共用的通用机制，而非只为睡觉写死。

## 2. 目标

- 睡觉表现为：趴下（一次） → 熟睡（安静呼吸为基底，每隔几秒随机插播「动耳朵」或「摇尾巴」一次后回到呼吸） → 起床（**倒放趴下过程＝起身**）后回到跟随 / idle。
- 抽出通用的「分段动作」机制，idle 也能复用（先以退化配置接入，行为不变，区间位子留好）。
- 段边界、fps、随机间隔等全部集中为常量，方便后续逐帧微调（先用大概区间）。
- **不修改**通用逐帧播放器 `useSpriteAnimation`。

## 3. 抽帧分析（sleep，cat-sleep 共 241 帧 0000–0240）

逐帧抽样观察到，`190–240` 这段循环里**清晰可分的肢体动作主要是尾巴**：尾巴从平摊地面 → 抬起卷成毛球（约 218–226 最高）→ 放下回到平摊（240≈190，可无缝循环）。耳朵在素材里只随呼吸轻微起伏，没有强独立节拍。

用户基于此拍板，先按**大概区间**实现，后续自行微调：

| 段 | 区间（帧） | 含义 |
|---|---|---|
| intro | 0 – 189 | 坐下→趴下；起床时倒放 |
| breathe（base） | 180 – 195 | 安静呼吸，作为熟睡基底 |
| ear | 195 – 214 | 动耳朵（随机插播） |
| tail | 214 – 240 | 摇尾巴（随机插播） |

> 注：区间为「大概值」，端点以常量形式存放，预期会再调。`breathe` 与 `intro` 尾部有重叠（180–189）属正常。

## 4. 方案：通用「分段动作」机制

三个备选方案中（① 独立睡觉编排器 / ② 通用分段机制 / ③ 塞进 useCatBrain），因 **idle 也要复用分段**，选定 **② 通用分段机制**。

### 4.1 声明式配置（`src/actions/`）

新增一个分段动作配置类型（端点均为常量，便于微调）：

```ts
interface SegmentRange { start: number; end: number } // 端点约定见下

interface TwitchDef {
  name: string;          // 调试用标签，如 "ear" / "tail"
  range: SegmentRange;   // 该插播小动作的帧区间
  weight?: number;       // 随机权重，默认 1
  fps?: number;          // 该段播放速度，默认取动作级 fps
}

interface SegmentedActionDef {
  framesKey: string;             // 指向 frames.ts 中的帧列表（sleep / idle）
  intro?: SegmentRange;          // 进入时正放一次（可选）
  base: SegmentRange;            // 基底循环（默认乒乓，见 4.3）
  twitches: TwitchDef[];         // 随机插播池（可为空＝纯基底循环）
  outro?: SegmentRange | 'introReversed'; // 退出时放一次（可选）
  twitchDelay: [number, number]; // 两次插播之间的随机间隔(ms) [min,max]
  fps: number;                   // 动作级默认 fps
  introFps?: number;             // intro / outro 单独的 fps（趴下/起身可调快）
  basePingPong?: boolean;        // base 是否乒乓，默认 true
  autoEndMs?: number;            // 自动结束（sleep 的 2 分钟自动醒）；不设＝不自动结束
}
```

**端点约定**：`start` 含、`end` 不含（左闭右开，与 `Array.prototype.slice` 一致），运行器内统一用 `frames.slice(start, end)`。文档表格里写的 `0–189`、`214–240` 在配置里相应取 `{start:0,end:190}`、`{start:214,end:241}` 等（实现计划阶段最终敲定，避免差一错误）。

### 4.2 通用运行器 `src/composables/useSegmentedAction.ts`

底层只依赖现有 `useSpriteAnimation`，通过给它喂「预切好 / 乒乓拼接 / 倒序」的帧数组来编排。**各段数组在 `start()` 时按配置预切一次并缓存**，不在每次插播时现切。

对外接口：

```ts
interface SegmentedController {
  currentSrc: Ref<string>;            // 当前帧 URL，透传自底层播放器
  start(cfg: SegmentedActionDef): void;   // 正放 intro → 进基底循环 → 随机插播
  requestExit(onDone: () => void): void;  // 有 outro 则放完再回调；否则立即回调
  stop(): void;                       // 硬停，不回调
}
```

内部状态机阶段：

```
intro    ：正放 intro 一次（若配置了）→ 进入 base
base     ：循环播放基底（乒乓）；同时挂一个随机定时器，到点 → twitch
twitch   ：从池中按 weight 随机挑一个，正放一次 → 回 base（重排下次随机定时器）
exiting  ：requestExit 触发；放 outro（introReversed＝intro 帧倒序）一次 → onDone
```

- `requestExit` 在任意阶段都可调用：先停掉基底 / 插播定时器与当前播放，再放 outro（或立即回调）。
- `autoEndMs`：进入 base 后挂一个一次性定时器，到点自动触发 `requestExit`（由 `useCatBrain` 提供「醒来后回到哪个状态」的回调）。
- `stop()`：硬停，清掉所有定时器，不放 outro、不回调（用于销毁 / 强制中断）。

### 4.3 基底「乒乓循环」

为避免 `base` 正向循环在 `end→start` 接缝处跳帧，基底数组用**正放 + 反放拼接**：
`pingpong = [...slice(s,e), ...slice(s,e).reverse()]`，再以 `loop:true` 交给播放器。`basePingPong:false` 时退化为普通正向循环（idle 退化情形可用）。

### 4.4 倒放（outro = `introReversed`）

起床＝把趴下过程倒过来。运行器在 `start()` 时即缓存 `introReversed = slice(intro).reverse()`，`requestExit` 时以 `introFps` 播放一次。intro 共 190 帧，24fps 下约 8 秒偏慢，故 `introFps` 单独可调（趴下、起身都用它）。

## 5. 两个消费者的配置

### 5.1 sleep

```
framesKey   : 'sleep'
intro       : 0–189            // 趴下；倒放＝起身
base        : 180–195 呼吸（乒乓）
twitches    : [ ear 195–214, tail 214–240 ]
outro       : 'introReversed'  // 起身
twitchDelay : [3000, 7000]     // 大概值，可调
autoEndMs   : 120000           // 2 分钟自动醒
fps / introFps : 大概值，可调
```

### 5.2 idle（退化接入，行为不变）

```
framesKey   : 'idle'（IDLE_FRAMES / cat-idla）
intro       : 无
base        : 整段 cat-idla（basePingPong 可按需）
twitches    : []               // 暂空，留给老大以后填区间
outro       : 无（立即退出）
twitchDelay : 不生效（无插播）
fps         : 现有 idleFps
```

idle 接入后表现与现状一致（整段循环、无插播），但插播 / 基底位子已就绪：以后只需往 idle 的 `twitches` 填区间即可生效，无需再改结构。

## 6. 与 `useCatBrain` 的整合

`useCatBrain` 持有一个 `useSegmentedAction` 实例，idle 状态与 sleep 动作都走它：

- `enterIdle()`：改为 `seg.start(IDLE_SEGMENTED_CFG)`（退化配置）。其余 idle 自动播放动作（IDLE_POOL，如 wiki）逻辑不变，仍走原有一次性 `useSpriteAnimation` 路径。
- `trigger('sleep')`：改为 `seg.start(SLEEP_CFG)`，记录 `actionResume`。
- `wake()`（点击 / 程序触发）：改为 `seg.requestExit(finishAction)` —— 先放起身 outro，再回到 follow / idle。
- `autoEndMs`：到点由运行器调用 `requestExit`，回调同 `wake()`。
- 销毁（`onUnmounted`）：`seg.stop()`。
- `interruptible`：sleep 仍为不可打断（鼠标移动不唤醒，只有点击 / 自动醒）；该判定保留在 `useCatBrain` 的 action 分支。

`currentSrc` 计算属性：`follow` 状态取 gaze，其余（idle / action）取 `seg.currentSrc`。

> 取舍：wiki 等「一次性、无分段」的 IDLE_POOL 动作**暂不**迁移到分段机制（YAGNI），继续走现有简单路径，只有 idle 和 sleep 用分段运行器。

## 7. 边界与注意点

- **倒放时长**：intro 190 帧，`introFps` 默认值需斟酌（24fps≈8s 偏慢）；做成常量，先给个偏快的默认值，老大再调。
- **接缝跳帧**：base 用乒乓避免；ear/tail 起止帧与 base 端点不完全衔接会有轻微跳帧，属「大概区间」的已知代价，后续微调。
- **退出时正在播插播**：`requestExit` 必须能中断当前 twitch 与所有定时器后再走 outro。
- **autoEnd 与点击竞态**：自动醒定时器与点击都走 `requestExit`，需保证只执行一次（进入 exiting 后忽略重复请求）。
- **差一错误**：表格区间为口头大概值，实现计划阶段统一按「左闭右开 + slice」敲定常量，避免 off-by-one。

## 8. 验证方式（无测试运行器）

项目无测试框架，靠 `pnpm build`（含 `vue-tsc --noEmit` 类型检查）+ 手动跑 `pnpm app:dev` 观察：

1. 触发睡觉 → 猫趴下（intro 正放一次）。
2. 熟睡期间大部分时间安静呼吸，每隔几秒随机动耳朵 / 摇尾巴一次后归于平静。
3. 点击 → 猫起身（intro 倒放）后恢复跟随 / idle。
4. 静置 2 分钟 → 自动起身。
5. idle 行为与改动前一致（整段循环）。

## 9. 不在本次范围

- idle 的具体插播区间（老大以后填）。
- wiki 等一次性动作迁移到分段机制。
- 逐帧精修段边界（先用大概区间）。
- 修改 `useSpriteAnimation`（保持通用、零改动）。

## 10. 涉及文件

- 新增 `src/composables/useSegmentedAction.ts`（运行器）。
- 修改 `src/actions/index.ts`（新增 `SegmentedActionDef` 类型与 sleep / idle 配置）。
- 可能新增 `src/actions/segments.ts` 集中存放段常量（或并入 index.ts）。
- 修改 `src/composables/useCatBrain.ts`（idle / sleep / wake 改走运行器）。
- 不改 `src/composables/useSpriteAnimation.ts`。
</content>
</invoke>
