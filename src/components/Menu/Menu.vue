<template>
  <!-- 猫爪菜单（SVG）：使用 src/assets/猫爪.svg 拆出的 6 个独立子路径——
       1 条蜿蜒装饰线条 + 4 趾 + 1 掌垫。5 个垫保持实心橙色填充作为可点击区，
       装饰线条以描边形式呈现并做「一笔画」动画。点空白/外部即可关闭。 -->
  <div class="menu" @mousedown.stop>
    <svg
      class="menu__svg"
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      :width="SIZE"
      :height="SIZE"
    >
      <!-- 把原 SVG 的 1024 坐标系整体缩放进 200 画布 -->
      <g :transform="PAW_TRANSFORM">
        <!-- 装饰线条层：沿路径方向的「一笔画」描边动画。
             OUTLINE_D 是装饰笔触的中心线（沿原闭合形状采样取中线得来），
             所以 stroke 出来就是单线，不会出现内外双线。
             pathLength=1000 把路径长度归一化为 1000，dasharray/dashoffset
             与真实弧长解耦。线条与脚趾 pop-in 同时开始，节奏并行。 -->
        <path
          class="menu__outline"
          :d="OUTLINE_D"
          pathLength="1000"
        />

        <!-- 5 个爪垫：每个一组（实心填充形状 + 居中文字）。
             由于已套用 PAW_TRANSFORM，文字坐标用原 1024 坐标系直接给。 -->
        <g
          v-for="(pad, i) in pawPads"
          :key="pad.slot.key"
          class="menu__pad"
          :class="{ 'menu__pad--active': pad.active }"
          :style="{ animationDelay: `${PAD_BASE_DELAY + i * STEP_DELAY}ms` }"
          @click.stop="onPadClick(pad)"
        >
          <path class="menu__pad-shape" :d="pad.pathD" />
          <text
            class="menu__pad-label"
            :x="pad.tx"
            :y="pad.ty"
            text-anchor="middle"
            dominant-baseline="central"
          >
            {{ pad.item.label }}
          </text>
        </g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  PAW_SLOTS,
  type MenuItemConfig,
} from "../../composables/useMenuSettings";

const props = defineProps<{
  /** 菜单项配置列表（固定 5 项，与 PAW_SLOTS 一一对应）。 */
  items: MenuItemConfig[];
  /** 偷看 / 穿透当前开关状态（用于对应垫高亮）。 */
  follow: boolean;
  passthrough: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:follow", value: boolean): void;
  (e: "update:passthrough", value: boolean): void;
  (e: "calibrate"): void;
  (e: "boss"): void;
  (e: "quit"): void;
  (e: "trigger", name: string): void;
}>();

/** SVG 画布尺寸（viewBox 逻辑单位，正方形）。 */
const SIZE = 200;
/** 5 个爪垫逐个展开的步进延时（毫秒）。 */
const STEP_DELAY = 60;
/**
 * 爪垫整体延迟出场（毫秒）：设为 0 让脚趾与装饰线条同时开始动画，
 * 整体节奏「线条慢慢长 + 4 趾 + 掌垫并行 pop-in」。
 */
const PAD_BASE_DELAY = 0;

/**
 * 把原 SVG（viewBox 1024×1024）整体缩放到本菜单 200×200 画布。
 * 缩放系数 200/1024 ≈ 0.1953，垫的几何与文字坐标都用原 1024 坐标系。
 */
const PAW_TRANSFORM = "scale(0.1953125)";

/**
 * 装饰线条主体——老大修改后的单线版本（fill:none + stroke），
 * 沿爪印走向一笔画出来。原 SVG 的起点 `m708 932` 是占位值，
 * 这里调到 `m789 844`，让线条 bbox 中心落在 5 个垫的几何中心 (518, 495) 附近。
 */
const OUTLINE_D =
  "m789 880 1 2 1-1q8-180 113-274c34-30 46-70 36-111-9-35-34-64-59-70q-23-4-43 7l-10 6-2 1-2 2h-1l-1 1-5 2h-7l-6-2-7-5-3-6-1-6v-3l1-2 2-5v-1l1-1c10-15 18-54 15-87q-6-70-74-98c-69-27-115-4-147 72-8 18-34 15-38-3q-27-139-148-118c-89 17-119 70-94 167 5 18-16 32-31 20q-62-50-138-6l-2 1-1 1c-48 37-58 73-42 119l1 2 1 4 1 1 2 4v1l2 4 1 3 2 4 2 3 2 4 2 3 2 4 2 4 3 3 2 4 3 4 3 5 3 4 3 5 3 4 4 5 5 8 8 11 14 18q16 23 28 56l1 6q7 22 11 49l1 7 1 7 1 3 1 7 1 8v7l1 4v7l1 8v8l1 8v9l1 8v63l-1 10v10";

/**
 * 5 个爪垫的子路径（实心填充）+ 文字锚点（用原 1024 坐标系）。
 * 顺序与 PAW_SLOTS 一致：左趾 → 左中趾 → 右中趾 → 右趾 → 掌垫。
 * 坐标由原 path 的几何中心算得：
 *   - 4 趾取圆弧端点中点；
 *   - 掌垫取 bbox 中心 (≈509, 627) ——视觉上的几何中心。
 */
const PAD_DEFS: Array<{
  slotKey: string;
  /** 该爪垫的填充路径（绝对坐标）。 */
  pathD: string;
  /** 文字 x/y（原 1024 坐标系，经由父 g 的 scale 自动缩放）。 */
  tx: number;
  ty: number;
}> = [
  {
    slotKey: "toe-left",
    pathD:
      "M221.1942 384.9595a84.68214138 84.68214138 0 1 1 0 169.3651926 84.68214138 84.68214138 0 0 1 0-169.3651926z",
    tx: 221,
    ty: 470,
  },
  {
    slotKey: "toe-left-center",
    pathD:
      "M352.3936 274.0904a84.68214138 84.68214138 0 1 1 161.07930974 52.34017607 84.68214138 84.68214138 0 0 1-161.07930974-52.34017607z",
    tx: 433,
    ty: 300,
  },
  {
    slotKey: "toe-right-center",
    pathD:
      "M606.4737 316.4151a84.68214138 84.68214138 0 1 1 161.11388355 52.37384004 84.68214138 84.68214138 0 0 1-161.11388355-52.34017608z",
    tx: 687,
    ty: 343,
  },
  {
    slotKey: "toe-right",
    pathD:
      "M803.4897 478.1595a63.55300361 63.55300361 0 1 1 63.52024949 110.03838049 63.55300361 63.55300361 0 0 1-63.55391343-110.03747065z",
    tx: 835,
    ty: 533,
  },
  {
    slotKey: "center-pad",
    pathD:
      "M540.9909 471.5723c47.08222976 7.85189075 82.85245977 31.942547 112.26657059 63.81958577 43.18994833 46.84931156 65.38359504 99.88824222 65.21709493 158.75012778-0.06641807 20.43038317-4.724782 39.79625743-17.96836505 56.56545772-19.43138249 24.68932879-48.34690277 33.37462997-82.08637727 32.04353888-29.38135669-1.19825495-56.00044913-9.4168099-76.69741448-29.94727512-5.62279082-5.55637274-12.54391865-10.21473667-19.29763649-14.80668251a53.07168478 53.07168478 0 0 0-46.75104918-7.51980037c-8.48513709 2.49568208-17.3023646 4.858528-24.88858305 8.71805531-25.48816543 12.91058283-52.77325833 11.9780002-80.25669566 4.32536368-36.73465692-10.31481871-63.68674961-30.44586562-70.54145933-64.65117651-2.8951004-14.37541992-2.8951004-30.31302947 1.26467303-44.08795716 24.12341037-79.72535103 80.09019553-134.66038137 171.2612923-160.28138295a149.20048173 149.20048173 0 0 1 68.47794966-2.92785452z",
    /** 掌垫 bbox 中心 (≈509, 627)：视觉几何中心，避免文字向下/向右偏。 */
    tx: 509,
    ty: 627,
  },
];

/** 预计算每个爪垫的填充路径 + 对应菜单项数据。 */
const pawPads = computed(() =>
  PAW_SLOTS.map((slot, i) => {
    const item = props.items[i];
    const def = PAD_DEFS[i];
    const active =
      item.kind === "builtin" &&
      ((item.ref === "follow" && props.follow) ||
        (item.ref === "passthrough" && props.passthrough));
    return { slot, item, pathD: def.pathD, tx: def.tx, ty: def.ty, active };
  }),
);

/** 点击一个爪垫：按类型与功能标识分发。 */
function onPadClick(pad: { item: MenuItemConfig }) {
  const item = pad.item;
  if (item.kind === "builtin") {
    switch (item.ref) {
      case "follow":
        emit("update:follow", !props.follow);
        return;
      case "passthrough":
        emit("update:passthrough", !props.passthrough);
        return;
      case "calibrate":
        emit("calibrate");
        break;
      case "boss":
        emit("boss");
        break;
      case "quit":
        emit("quit");
        break;
    }
    emit("close");
    return;
  }
  emit("trigger", item.ref);
  emit("close");
}
</script>

<style scoped>
.menu {
  display: flex;
  user-select: none;
  font-family: -apple-system, "Microsoft YaHei", "Segoe UI", sans-serif;
}

.menu__svg {
  overflow: visible;
  filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.4));
}

/* ── 装饰线条：橙色「一笔画」描边动画 ──
   OUTLINE_D 是单线 path（fill:none），所以直接 stroke 没有内外双线问题。
   pathLength=1000 把路径长度归一化为 1000，dashoffset 1000→0 表现为
   线条沿其自身路径方向慢慢被画出来。stroke-width 在 1024 坐标系下设为 14，
   缩放到 200 后视觉宽度约 2.7px。 */
.menu__outline {
  fill: none;
  stroke: #f1760b;
  stroke-width: 14;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  animation: menu-outline-draw 0.8s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}

/* ── 爪垫：实心橙色填充，pop-in 动画沿用原弹性曲线 ── */
.menu__pad {
  cursor: pointer;
  transform-box: fill-box;
  transform-origin: center;
  animation: menu-pad-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.menu__pad-shape {
  fill: #f1760b;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 4;
  stroke-linejoin: round;
  transition: fill 0.15s, stroke 0.15s, filter 0.15s;
}

.menu__pad:hover .menu__pad-shape {
  fill: #ff8a2b;
  stroke: rgba(255, 255, 255, 0.4);
  filter: brightness(1.1);
}

/* 开关型菜单项开启时：蓝色填充凸出选中态。 */
.menu__pad--active .menu__pad-shape {
  fill: #74aeff;
  stroke: rgba(255, 255, 255, 0.55);
}

.menu__pad--active:hover .menu__pad-shape {
  fill: #8ec0ff;
}

/* 文字 font-size 写在 1024 坐标系下：56 缩放后约 11px。 */
.menu__pad-label {
  font-size: 56px;
  fill: #fff;
  pointer-events: none;
  font-weight: 600;
  paint-order: stroke fill;
  stroke: rgba(0, 0, 0, 0.45);
  stroke-width: 6;
  stroke-linejoin: round;
}

@keyframes menu-outline-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes menu-pad-in {
  from {
    opacity: 0;
    transform: scale(0.2);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
