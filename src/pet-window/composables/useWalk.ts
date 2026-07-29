/**
 * useWalk —— 窗口位移引擎（行走）。
 *
 * 位移是**动作属性**：当前帧所属动作配了 move 就走，没配就不走——这是唯一的
 * 启停判据，不存在额外的"停止行走"逻辑。引擎用 requestAnimationFrame 按真实
 * dt 推进「段游标 + 位置」，撞屏幕边界按台球式反射，并维护猫的当前朝向 heading
 * 供精灵镜像使用。
 *
 * 反射以「累积镜像」实现（`flipX` / `flipY`）：撞墙翻转的是整条路径的朝向，
 * 之后每一段的配置方向都经 `applyFlip` 换算。若只改当前段的运行方向，单段
 * `loop` 动作会在换段时把反射结果洗掉，猫便卡在边缘反复来回蹭。
 *
 * 位置用本地 f64 维护而非每帧回读窗口——回读会让 IPC 翻倍。小数余量留在累加器
 * 里，故 5px/s 这种慢速不会被每帧取整吃光。只在「开始行走」「从暂停恢复」
 * 「从最小化恢复」时同步一次真实位置。
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { MoveSpec } from '../../pet-core/clips'

/** 后端 pet_walk_bounds 返回的窗口左上角可取范围（物理像素）。 */
interface WalkBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 单帧最大推进时长（毫秒）：窗口不可见时 rAF 被节流，恢复后不能一次跳很远。 */
const MAX_FRAME_MS = 100

/** 物理左键轮询间隔（毫秒）。只在有位移的动作播放期间运行。 */
const LMB_POLL_MS = 100

/** 最小化时 Windows 把窗口停到 (-32000,-32000)，坐标低于该值即视为最小化。 */
const MINIMIZED_COORD = -30000

export interface WalkOptions {
  /** 当前帧所属动作的位移序列；null = 不移动。 */
  move: () => MoveSpec | null
  /** 猫的显示倍率（displaySettings.size）：实际速度 = 配置速度 × size。 */
  size: () => number
  /** 是否暂停位移（菜单打开 / 头部校准中）。暂停期段计时一并冻结。 */
  paused: () => boolean
  /**
   * 鼠标当前是否悬停在猫身上。左键暂停位移仅在此为 true 时生效
   * （覆盖拖猫 / 长按摸猫），避免在别处按左键也冻住行走。
   */
  overCat: () => boolean
}

export interface WalkController {
  /** 猫当前朝向：行走时跟随水平速度，供行走朝向翻转使用。 */
  heading: Ref<'left' | 'right'>
  /**
   * 当前动作是否配了位移。为 false（静止动作）时渲染按素材朝向 facing 原样站立，
   * 不随 heading 翻转——保证「素材朝向」在无移动时也确定生效。
   */
  moving: Ref<boolean>
}

export function useWalk(opts: WalkOptions): WalkController {
  const heading = ref<'left' | 'right'>('right')
  /** 当前动作是否配了位移（watch(opts.move) 维护）；决定渲染是否启用行走朝向翻转。 */
  const moving = ref(false)
  const win = getCurrentWindow()

  /** 本地维护的窗口左上角位置（物理像素，带小数）。 */
  let pos = { x: 0, y: 0 }
  /** 上次真正提交给窗口的整数位置：变化不足 1 物理像素就不发 IPC。 */
  let committed = { x: 0, y: 0 }

  let spec: MoveSpec | null = null
  let segIndex = 0
  let segElapsed = 0
  /** 当前段的运行方向 = 该段配置方向经 `applyFlip` 镜像后的结果。 */
  let dirRuntime = 0
  /**
   * 累积镜像标志：撞左右墙 toggle `flipX`、撞上下墙 toggle `flipY`，并作用于
   * **之后每一段**的配置方向。这样反射改的是"整条路径的朝向"而非单段——
   * 段间的相对关系（先右走再下走）原样保留，换段/循环也不会把反射结果洗掉。
   * 只在动作切换时清零。
   */
  let flipX = false
  let flipY = false
  /** 段序列已走完且 loop 关闭：位移冻结，动画继续。 */
  let finished = false

  let bounds: WalkBounds | null = null
  let sf = 1
  let rafId: number | undefined
  let lastTs = 0
  let lmbDown = false
  let lmbTimer: number | undefined
  /** 上一帧是否处于暂停：由暂停转为运行时要重新同步真实位置。 */
  let wasPaused = false
  /** syncPos 正在进行中：未完成前不推进，防止用陈旧 pos 覆盖用户刚拖到的位置。 */
  let syncing = false
  /** 最小化标志：由 Moved 事件的停靠坐标判定，不额外花 IPC。 */
  let minimized = false
  let unlistenMoved: UnlistenFn | undefined
  /** 组件已销毁标志：防止 await 后的回调在销毁后启动引擎。 */
  let disposed = false
  /** 动作代次令牌：换动作时旧回调的 await 恢复后发现代次不符即放弃启动。 */
  let gen = 0

  /** 把角度归一化到 [0,360)。 */
  function norm(deg: number): number {
    return ((deg % 360) + 360) % 360
  }

  /** 从窗口读一次真实位置；最小化（-32000）时返回 false 表示不可采纳。 */
  async function syncPos(): Promise<boolean> {
    syncing = true
    try {
      const p = await win.outerPosition()
      if (p.x <= MINIMIZED_COORD || p.y <= MINIMIZED_COORD) return false
      pos = { x: p.x, y: p.y }
      committed = { x: p.x, y: p.y }
      return true
    } catch {
      return false
    } finally {
      syncing = false
    }
  }

  /** 查一次可行走边界与 scale factor。失败时置 null（本轮不移动）。 */
  async function syncBounds() {
    try {
      sf = await win.scaleFactor()
      bounds = await invoke<WalkBounds>('pet_walk_bounds', {
        scale: opts.size(),
      })
    } catch {
      bounds = null
    }
  }

  function pollLmb() {
    invoke<boolean>('pet_lmb_pressed')
      .then((v) => {
        lmbDown = v
      })
      .catch(() => {
        lmbDown = false
      })
  }

  /**
   * 把配置方向按当前累积镜像换算成运行方向。
   * 水平镜像（关于竖直轴）：`dir → 180 - dir`；垂直镜像：`dir → -dir`。
   * 两者可交换，故先后顺序不影响结果。
   */
  function applyFlip(dir: number): number {
    let d = dir
    if (flipX) d = 180 - d
    if (flipY) d = -d
    return norm(d)
  }

  /** 换到第 i 段：按该段配置方向 + 当前累积镜像求运行方向。 */
  function enterSegment(i: number) {
    segIndex = i
    dirRuntime = spec ? applyFlip(spec.segments[i].dir) : 0
  }

  /**
   * 推进段游标。用循环而非单次判断：dt 上限 100ms，若某段只有 30ms 会一帧跨多段。
   * ms ≤ 0 表示该段无限持续，不推进。
   */
  function advanceSegment(dt: number) {
    if (!spec) return
    segElapsed += dt
    for (;;) {
      const seg = spec.segments[segIndex]
      if (seg.ms <= 0 || segElapsed < seg.ms) return
      segElapsed -= seg.ms
      const next = segIndex + 1
      if (next < spec.segments.length) {
        enterSegment(next)
      } else if (spec.loop) {
        enterSegment(0)
      } else {
        finished = true
        return
      }
    }
  }

  function frame(ts: number) {
    rafId = requestAnimationFrame(frame)
    if (!spec || bounds === null) return

    const dt = lastTs === 0 ? 0 : Math.min(ts - lastTs, MAX_FRAME_MS)
    lastTs = ts

    // 暂停期段计时一并冻结——被拖着的猫不该"在心里继续走完这一段"。
    // 左键暂停仅在鼠标悬停于猫身上时生效（拖猫 / 长按摸猫），别处点鼠标不打断行走。
    if (opts.paused() || (lmbDown && opts.overCat()) || minimized) {
      wasPaused = true
      return
    }
    // 从暂停恢复：期间窗口可能被拖走，先同步真实位置，下一帧再继续推进。
    if (wasPaused) {
      wasPaused = false
      if (!syncing) void syncPos()
      return
    }
    if (dt <= 0 || finished) return

    advanceSegment(dt)
    if (finished) return

    const seg = spec.segments[segIndex]
    const rad = (dirRuntime * Math.PI) / 180
    const step = seg.speed * opts.size() * sf * (dt / 1000)
    const vx = Math.cos(rad) * step
    const vy = Math.sin(rad) * step

    // 朝向跟随水平分量；纯垂直段 / 停顿段（vx === 0）保持不变，不中途翻脸。
    if (vx > 0) heading.value = 'right'
    else if (vx < 0) heading.value = 'left'

    // X 轴：min > max 表示该轴无空间（内容比屏幕大），不移动也不反射，否则每帧抖。
    if (bounds.minX <= bounds.maxX) {
      pos.x += vx
      if (pos.x < bounds.minX || pos.x > bounds.maxX) {
        pos.x = Math.min(Math.max(pos.x, bounds.minX), bounds.maxX)
        // 撞左右边界：整条路径做一次水平镜像（含后续各段），当前段方向随之更新。
        if (spec.bounce) {
          flipX = !flipX
          dirRuntime = applyFlip(spec.segments[segIndex].dir)
        }
      }
    }
    // Y 轴同理。上下反射只改垂直分量，不翻转图像（垂直镜像会让猫倒栽葱）。
    if (bounds.minY <= bounds.maxY) {
      pos.y += vy
      if (pos.y < bounds.minY || pos.y > bounds.maxY) {
        pos.y = Math.min(Math.max(pos.y, bounds.minY), bounds.maxY)
        if (spec.bounce) {
          flipY = !flipY
          dirRuntime = applyFlip(spec.segments[segIndex].dir)
        }
      }
    }

    const nx = Math.round(pos.x)
    const ny = Math.round(pos.y)
    if (nx === committed.x && ny === committed.y) return
    committed = { x: nx, y: ny }
    win.setPosition(new PhysicalPosition(nx, ny)).catch(() => {})
  }

  function startEngine() {
    if (rafId !== undefined) return
    lastTs = 0
    wasPaused = false
    pollLmb()
    lmbTimer = window.setInterval(pollLmb, LMB_POLL_MS)
    rafId = requestAnimationFrame(frame)
  }

  function stopEngine() {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
    if (lmbTimer !== undefined) {
      window.clearInterval(lmbTimer)
      lmbTimer = undefined
    }
    lmbDown = false
  }

  // 最小化判定：Windows 把最小化窗口停到 (-32000,-32000)，读 Moved 事件即可，
  // 不必轮询 isMinimized。Pet.vue 的 onMoved 用的是同一个判据。
  win
    .onMoved(({ payload }) => {
      const parked =
        payload.x <= MINIMIZED_COORD || payload.y <= MINIMIZED_COORD
      if (parked) {
        minimized = true
        return
      }
      if (minimized) {
        // 从最小化恢复：采纳真实位置再继续走。
        minimized = false
        pos = { x: payload.x, y: payload.y }
        committed = { x: payload.x, y: payload.y }
      }
    })
    .then((fn) => {
      unlistenMoved = fn
    })
    .catch(() => {
      // 事件绑定不可用（销毁期间）——忽略。
    })

  // 当前动作变了（move 引用变了）：重置段游标，按需启停引擎。
  watch(
    opts.move,
    async (m) => {
      const myGen = ++gen
      spec = m
      moving.value = m !== null
      segIndex = 0
      segElapsed = 0
      finished = false
      // 新动作 = 新路径配置，累积镜像不跨动作继承。
      flipX = false
      flipY = false
      dirRuntime = m ? m.segments[0].dir : 0
      if (!m) {
        // heading 保持不变：猫停下后仍朝着刚才走的方向。
        stopEngine()
        bounds = null
        return
      }
      if (!(await syncPos())) {
        // 最小化中：不启动，等下次动作切换时再来。
        stopEngine()
        return
      }
      if (disposed || myGen !== gen) return
      await syncBounds()
      if (disposed || myGen !== gen) return
      startEngine()
    },
    { immediate: true },
  )

  // size 改变会让后端重新锚定窗口位置（猫脚不动）并 clamp，边界随之变化。
  watch(opts.size, async () => {
    if (!spec) return
    if (!(await syncPos())) return
    if (disposed) return
    await syncBounds()
  })

  onScopeDispose(() => {
    disposed = true
    stopEngine()
    unlistenMoved?.()
  })

  return { heading, moving }
}
