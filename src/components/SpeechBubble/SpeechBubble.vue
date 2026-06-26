<template>
  <Transition name="bubble">
    <div v-if="visible" class="bubble" :style="bubbleStyle">
      <!-- 云朵图单独一层（伪元素），仅给这一层加 drop-shadow，
           这样阴影沿 PNG 的不透明轮廓走，透明区域不会被描边。 -->
      <div class="bubble__cloud" :style="cloudStyle"></div>
      <div class="bubble__content" :style="contentStyle">
        <!-- 默认插槽优先；无插槽时显示 text。插槽内容可交互（按钮可点）。 -->
        <slot>
          <span class="bubble__text">{{ text }}</span>
        </slot>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const CLOUD_MAP = {
  // 宽红云（1558×1024）：底部左右两角小云尾，尾巴大致居左。
  cloud1: {
    url: new URL("../../assets/cloud1.png", import.meta.url).href,
    ratio: 3 / 2,
    maxW: 200,
    offsetX: 0.3,
    offsetY: 0,
    padding: "0 max(10%, 20px)",
    color: "#fff",
  },
  // 蓝方云（1024×1024）：底部中-右一个尖尾，下方留白。浅蓝→深字。
  cloud2: {
    url: new URL("../../assets/cloud2.png", import.meta.url).href,
    ratio: 1,
    maxW: 190,
    offsetX: -0.23,
    offsetY: 0.2,
    padding: "4% max(15%, 20px) 8%",
    color: "#fff",
  },
  // 思考云（1024×1024）：右下三个由大到小圆点尾，内容放左上主云区。白底→深字。
  cloud3: {
    url: new URL("../../assets/cloud3.png", import.meta.url).href,
    ratio: 1,
    maxW: 210,
    offsetX: 0,
    offsetY: 0.1,
    padding: "24% max(10%, 20px) 0%",
    color: "#333",
  },
} as const;

/** 可用的云朵种类。 */
type CloudKey = keyof typeof CLOUD_MAP;

const props = withDefaults(
  defineProps<{
    /** 气泡文字（无插槽时显示）。 */
    text?: string;
    /**
     * 是否显示。不传时由 text 是否非空决定（用于简单文本气泡）；
     * 用插槽时由父组件显式传 :show 控制显隐。
     */
    show?: boolean;
    /** 用哪张云：指定 cloud1/2/3，或 "random" 每次显示随机。 */
    variant?: CloudKey | "random";
  }>(),
  {
    text: "",
    show: undefined,
    variant: "random",
  },
);

/** 是否显示：显式 show 优先；否则看 text 是否非空。 */
const visible = computed(() =>
  props.show !== undefined ? props.show : !!props.text,
);

const CLOUD_KEYS = Object.keys(CLOUD_MAP) as CloudKey[];

/** 当前实际使用的云（random 时每次显示重新随机）。 */
const current = ref<CloudKey>(
  props.variant === "random" ? "cloud1" : props.variant,
);

/** 每次从「隐藏」变为「显示」时，按 variant 决定用哪张云。 */
watch(
  visible,
  (val, old) => {
    if (val && !old) {
      const random = CLOUD_KEYS[Math.floor(Math.random() * CLOUD_KEYS.length)];
      current.value = props.variant === "random" ? random : props.variant;
    }
  },
  { immediate: true },
);

/** 当前云的配置。 */
const conf = computed(() => CLOUD_MAP[current.value]);

/** 外层只负责定位、尺寸、文字色，云朵图交给伪元素层。 */
const bubbleStyle = computed(() => ({
  transform: `translate(${conf.value.offsetX * 100}%, ${conf.value.offsetY * 100}%)`,
  maxWidth: `${conf.value.maxW}px`,
  aspectRatio: conf.value.ratio,
  color: conf.value.color,
}));

/** 云朵层：只画 PNG，并在这一层加 drop-shadow，阴影才会沿透明轮廓走。 */
const cloudStyle = computed(() => ({
  backgroundImage: `url(${conf.value.url})`,
}));

const contentStyle = computed(() => ({
  padding: conf.value.padding,
}));
</script>

<style scoped lang="scss">
/* 气泡：相对定位、固定尺寸。云朵图由 .bubble__cloud 单独绘制（带轮廓阴影），
   文字层叠在云之上。这样阴影只贴 PNG 不透明轮廓，透明区域不会被描边。 */
.bubble {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 80px;

  /* 云朵层：绝对铺满父盒，仅画 PNG，drop-shadow 沿不透明轮廓投影。 */
  .bubble__cloud {
    position: absolute;
    inset: 0;
    background-size: 100% 100%;
    background-repeat: no-repeat;
    background-position: center;
    /* 两层 drop-shadow 叠出更柔和的轮廓阴影；按需调数值即可。 */
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.18))
      drop-shadow(0 1px 5px rgba(0, 0, 0, 0.12));
    pointer-events: none;
  }

  /* 内容层：放在云之上，承接文字 / 插槽交互。 */
  .bubble__content {
    position: relative;
    z-index: 1000;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    pointer-events: auto;
  }

  /* 文字：居中、最多 3 行省略。 */
  .bubble__text {
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    overflow: hidden;
    font-weight: 500;
  }
}

/* 出现/消失：底部为原点的弹性缩放淡入淡出（朝猫的尾巴处）。 */
.bubble-enter-active,
.bubble-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: 50% bottom;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: scale(0.6);
}
</style>
