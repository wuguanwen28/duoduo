<template>
  <!-- 猫爪菜单（SVG）：直接使用猫爪素材的 5 个独立填充路径，
       统一定位为猫爪造型。不再需要中心关闭按钮（点击空白/外部即可关闭）。 -->
  <div class="menu" @mousedown.stop>
    <svg
      class="menu__svg"
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      :width="SIZE"
      :height="SIZE"
    >
      <!-- 5 个爪垫：逐个动画展开。 -->
      <g
        v-for="(pad, i) in pawPads"
        :key="pad.slot.key"
        class="menu__pad"
        :class="{ 'menu__pad--active': pad.active }"
        :style="{ animationDelay: `${i * STEP_DELAY}ms` }"
        @click.stop="onPadClick(pad)"
      >
        <!-- 从 猫爪.svg 直接搬来的原始路径，经 transform 映射到 240×240 画布。 -->
        <g :transform="PAW_TRANSFORM">
          <path class="menu__pad-shape" :d="pad.pathD" />
        </g>
        <!-- emoji / label 在 240×240 坐标系中，用每个垫的中心位置。 -->
        <text
          class="menu__pad-emoji"
          :x="pad.tx"
          :y="pad.ty - 7"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {{ pad.item.emoji }}
        </text>
        <text
          class="menu__pad-label"
          :x="pad.tx"
          :y="pad.ty + 9"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {{ pad.item.label }}
        </text>
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
/** 逐个展开的步进延时（毫秒）。 */
const STEP_DELAY = 60;

/**
 * 从 猫爪.svg 原始坐标系（viewBox 0 0 1304 1024）到本菜单 240×240
 * 画布的仿射变换。各垫的路径数据无需改动，统一由此变换定位。
 *
 * 调 scale 控制整体大小，调 translate 控制水平/垂直偏移。
 */
const PAW_TRANSFORM = "translate(20, 25) scale(0.13)";

/**
 * 5 个爪垫的原始路径数据（直接从 猫爪.svg 复制）及其在 240×240 画布中
 * 的文字锚点（由原始中心 × scale + translate 计算得出）。
 */
const PAD_DEFS = [
  {
    slotKey: "toe-left",
    pathD:
      "M0 446.49054a171.094255 145.438963 90 1 0 290.877927 0a171.094255 145.438963 90 1 0-290.877927 0Z",
    tx: 39,
    ty: 83,
  },
  {
    slotKey: "toe-left-center",
    pathD:
      "M353.069892 190.999222a190.999222 149.508423 90 1 0 299.016847 0a190.999222 149.508423 90 1 0-299.016847 0Z",
    tx: 85,
    ty: 50,
  },
  {
    slotKey: "toe-right-center",
    pathD:
      "M887.858242 431.109679a149.508423 190.999222 6.71 1 0 44.634256-379.38186a149.508423 190.999222 6.71 1 0-44.634256 379.38186Z",
    tx: 138,
    ty: 56,
  },
  {
    slotKey: "toe-right",
    pathD:
      "M1126.923945 768.927392a140.307905 171.094255 12.07 1 0 71.553865-334.6237a140.307905 171.094255 12.07 1 0-71.553865 334.6237Z",
    tx: 171,
    ty: 103,
  },
  {
    slotKey: "center-pad",
    pathD:
      "M962.073434 786.025054c-10.704449 162.07067-167.201728 249.033261-352.36216 236.736415s-328.918531-118.899006-318.479481-281.058143 173.305918-264.957235 354.662289-271.415291c187.549028 37.686739 326.883801 153.577883 316.179352 315.737019Z",
    /** 掌垫视觉中心（原始坐标系约 x=650, y=800）。 */
    tx: 105,
    ty: 129,
  },
];

/** 预计算每个爪垫的路径 + 对应菜单项数据。 */
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
  filter: drop-shadow(0 6px 20px rgba(0, 0, 0, 0.35));
}

/* ── 爪垫：逐个缩放淡入，原点在 SVG 圆心。 ── */
.menu__pad {
  cursor: pointer;
  transform-box: view-box;
  transform-origin: 120px 120px;
  animation: menu-pad-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

/* 使用猫爪素材的原色（粉红 #f7999f），悬停/选中时叠加混合。 */
.menu__pad-shape {
  fill: #f7999f;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 1.2;
  stroke-linejoin: round;
  transition: fill 0.12s, filter 0.12s;
}

.menu__pad:hover .menu__pad-shape {
  fill: #ff8899;
  filter: brightness(1.15);
  stroke: rgba(255, 255, 255, 0.4);
}

/* 开关型菜单项开启时高亮整垫。 */
.menu__pad--active .menu__pad-shape {
  fill: #74aeff;
  stroke: rgba(100, 160, 255, 0.9);
}

.menu__pad--active:hover .menu__pad-shape {
  fill: #8ec0ff;
}

.menu__pad-emoji {
  font-size: 14px;
  pointer-events: none;
}

.menu__pad-label {
  font-size: 10px;
  fill: #f0f0f0;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.menu__pad--active .menu__pad-label {
  fill: #fff;
  font-weight: 600;
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
