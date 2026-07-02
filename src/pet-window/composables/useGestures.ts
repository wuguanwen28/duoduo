/**
 * 手势引擎 —— 识别猫咪本体上的单击、双击、右键、长按，并按配置分发动作。
 *
 * 拖动行为固定为 Tauri 原生窗口拖动，不参与手势配置。
 */
import { onMounted, onUnmounted, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { TriggerBinding, MouseTrigger } from "../../pet-core/triggerBindings";
import { resolveAction, type PetActionContext } from "../../pet-core/commands";

/** 达到该移动像素数即视为拖动。 */
const DRAG_THRESHOLD = 5;

/** 两次单击间隔小于该值则视为双击（毫秒）。 */
const DOUBLE_CLICK_MS = 300;

/** 按住超过该值视为长按（毫秒）。 */
const LONG_PRESS_MS = 600;

/**
 * 在目标元素上绑定手势识别。
 *
 * @param elRef 目标 DOM 元素（猫咪本体包裹层）
 * @param bindings 触发器绑定数组 ref
 * @param ctx 动作执行上下文
 */
export function useGestures(
  elRef: Ref<HTMLElement | undefined>,
  bindings: Ref<TriggerBinding[]>,
  ctx: PetActionContext,
): void {
  let lastClickTime = 0;
  let pendingClickTimer: number | undefined;

  /** 按 mouse 触发方式从绑定数组查 actionId；找不到返回空串（无操作）。 */
  function mouseAction(trigger: MouseTrigger): string {
    return (
      bindings.value.find((b) => b.kind === "mouse" && b.trigger === trigger)?.actionId ?? ""
    );
  }

  /** 按动作 id 统一分发；空 / 未知为空操作。 */
  function dispatch(actionId: string, pos?: { x: number; y: number }): void {
    ctx.pendingMenuPos.value = pos;
    resolveAction(actionId, ctx);
    ctx.pendingMenuPos.value = undefined;
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;

    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let longPressTimer: number | undefined;

    function cleanup() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (longPressTimer !== undefined) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    }

    function onMove(ev: MouseEvent) {
      if (dragging) return;
      if (
        Math.hypot(ev.clientX - start.x, ev.clientY - start.y) >
        DRAG_THRESHOLD
      ) {
        dragging = true;
        cleanup();
        getCurrentWindow().startDragging().catch(() => {});
      }
    }

    function handleClick() {
      const now = Date.now();
      if (now - lastClickTime < DOUBLE_CLICK_MS) {
        // 双击：清掉待处理的单击定时器，执行双击动作。
        lastClickTime = 0;
        if (pendingClickTimer !== undefined) {
          window.clearTimeout(pendingClickTimer);
          pendingClickTimer = undefined;
        }
        dispatch(mouseAction("doubleClick"), start);
        return;
      }

      lastClickTime = now;
      // 延迟执行单击动作，给双击判断留窗口。
      pendingClickTimer = window.setTimeout(() => {
        pendingClickTimer = undefined;
        if (lastClickTime === now) {
          lastClickTime = 0;
          dispatch(mouseAction("leftClick"), start);
        }
      }, DOUBLE_CLICK_MS);
    }

    function onUp(ev: MouseEvent) {
      if (ev.button !== 0) return;
      cleanup();
      if (dragging) return;
      handleClick();
    }

    longPressTimer = window.setTimeout(() => {
      dragging = true; // 标记为拖动态，阻止 mouseup 触发单击/双击
      cleanup();
      dispatch(mouseAction("longPress"), start);
    }, LONG_PRESS_MS);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch(mouseAction("rightClick"), { x: e.clientX, y: e.clientY });
  }

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("contextmenu", onContextMenu);
  });

  onUnmounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.removeEventListener("mousedown", onMouseDown);
    el.removeEventListener("contextmenu", onContextMenu);
    if (pendingClickTimer !== undefined) {
      window.clearTimeout(pendingClickTimer);
    }
  });
}
