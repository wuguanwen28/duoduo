<template>
  <!-- 缺资源引导：透明窗口右下角弹一张卡片，提供「查看教程 / 重新加载 / 退出」。 -->
  <div class="missing">
    <div class="missing__card">
      <div class="missing__title">🐱 还没找到猫咪素材</div>
      <p class="missing__msg">{{ message }}</p>
      <p class="missing__path" v-if="root">
        资源目录：<code>{{ root }}</code>
      </p>
      <div class="missing__btns">
        <el-button type="primary" size="small" @click="showGuide = true">
          查看设置教程
        </el-button>
        <el-button size="small" @click="emit('retry')">重新加载</el-button>
        <el-button size="small" text @click="onQuit">退出</el-button>
      </div>
    </div>

    <!-- 教程对话框：说明目录结构与 manifest.json 写法。 -->
    <el-dialog
      v-model="showGuide"
      title="如何添加猫咪素材"
      width="92%"
      :teleported="false"
      class="missing__dialog"
    >
      <div class="guide">
        <p>在<b>程序所在目录</b>（与 exe 同级）建一个 <code>resources/</code> 文件夹，按下面结构放素材，然后点「重新加载」。</p>
        <pre class="guide__code">resources/
  manifest.json        ← 资源清单（见下）
  follow/   *.webp     ← 跟随光标的方向帧（可选）
  idle/
    breathe/ *.webp    ← 空闲基底循环（必需）
    blink/   *.webp    ← 随机插播动作
  sleep/
    lieDown/ *.webp    ← 趴下（可选）
    breathe/ *.webp</pre>
        <p>帧文件名建议零填充（<code>frame_000000.webp</code>…），按文件名排序即播放顺序。</p>
        <p><b>manifest.json</b> 最小示例（只要有 idle 就能跑）：</p>
        <pre class="guide__code">{
  "version": 1,
  "follow": { "dir": "follow", "clockwise": true, "startAngle": 0 },
  "actions": {
    "idleBreathe": { "dir": "idle/breathe", "fps": 24, "yoyo": true },
    "idleBlink":   { "dir": "idle/blink", "fps": 24 }
  },
  "behaviors": {
    "idle": {
      "weight": 10, "duration": [15000, 40000], "interruptible": true,
      "base": "idleBreathe",
      "random": [ { "action": "idleBlink", "weight": 5 } ],
      "delay": [3000, 8000]
    }
  }
}</pre>
        <p class="guide__tip">
          每个动作 = 一个独立文件夹；动作字段 <code>dir/fps/yoyo/reverse/offsetX/offsetY/scale</code>，<code>dir</code> 支持绝对路径。
          也可设环境变量 <code>DUODUO_RESOURCES</code> 指向任意素材目录。
        </p>
      </div>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

defineProps<{
  /** 失败原因说明。 */
  message: string;
  /** 资源根目录绝对路径（提示用户往哪放素材）。 */
  root: string;
}>();

const emit = defineEmits<{
  /** 用户点「重新加载」：父级重新尝试 loadResources。 */
  (e: "retry"): void;
}>();

/** 教程对话框是否打开。 */
const showGuide = ref(false);

/** 退出应用（与托盘「退出」一致）。 */
function onQuit() {
  invoke("pet_quit").catch(() => {});
}
</script>

<style scoped>
.missing {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 16px;
  box-sizing: border-box;
  font-family: -apple-system, "Microsoft YaHei", "Segoe UI", sans-serif;
}

.missing__card {
  width: 280px;
  background: rgba(28, 28, 30, 0.92);
  color: #f0f0f0;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 14px 16px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.missing__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.missing__msg {
  font-size: 12px;
  color: #c8c8cc;
  line-height: 1.5;
  margin: 0 0 8px;
  word-break: break-all;
}

.missing__path {
  font-size: 11px;
  color: #999;
  margin: 0 0 12px;
  word-break: break-all;
}

.missing__path code {
  color: #4a9eff;
}

.missing__btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.guide {
  font-size: 13px;
  line-height: 1.6;
  color: #333;
}

.guide code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: "Consolas", "Microsoft YaHei", monospace;
}

.guide__code {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  font-family: "Consolas", monospace;
  white-space: pre;
}

.guide__tip {
  color: #666;
  font-size: 12px;
}
</style>
