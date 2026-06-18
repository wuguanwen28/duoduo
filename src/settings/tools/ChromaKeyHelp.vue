<template>
  <el-dialog
    v-model="visible"
    title="抠图使用说明"
    width="760px"
    class="ck-help"
    center
  >
    <div class="ck-help__body">
      <p class="ck-help__lead">
        这个工具能把视频里的<b>纯色背景</b>（绿幕、蓝幕、纯白底之类）变成透明，最后导出一串带透明背景的图片，用来做猫咪动作素材。左边显示原始画面，右边是抠完的效果——看到棋盘格就表示这块已经透明了。
      </p>

      <h3 class="ck-help__h">怎么用（四步）</h3>
      <ol class="ck-help__ol">
        <li><b>选视频</b>：点"选视频"挑一个文件，等它解码完。</li>
        <li>
          <b>找一帧看效果</b
          >：拖时间轴选一帧能看清主体的画面，右边会实时显示当前参数下的抠图效果。
        </li>
        <li>
          <b>调颜色和容差</b
          >：一般打开就自动认出背景色了。右边还留有残色就把<b>容差</b>调大；主体被误抠了就把容差调小。
        </li>
        <li><b>填输出目录</b>，点<b>开始转换</b>，等它导出完。</li>
      </ol>

      <h3 class="ck-help__h">"抠图设置"里每条记录什么意思</h3>
      <p class="ck-help__p">
        每一条记录就是<b>"要抠掉的一种颜色"</b>。背景只有一种色，一条就够；要是背景有好几种颜色（比如有亮绿也有深绿），就点<b>添加抠色记录</b>多加几条，每条配一个颜色，画面上命中任意一种就算背景。
      </p>
      <ul class="ck-help__ul">
        <li>
          <b>颜色</b
          >：要抠掉的背景色。可以手选、用<b>吸管</b>在画面上点一下取色，或者点<b>自动识别</b>让它自己挑。
        </li>
        <li>
          <b>容差</b
          >：宽容度。值越大认得越宽（同种颜色的深浅一起抠掉）；值越小越保守。白色、灰色不会被误抠。
        </li>
      </ul>

      <h3 class="ck-help__h">什么时候用"高级设置 / 区域抠图"</h3>
      <p class="ck-help__p">
        每条记录的<b>高级设置</b>打开后，能在左边画面拖一个<b>蓝色框</b>限定只在框里抠，还可以指定<b>只在某几帧</b>里生效。这种"只在某块、某几帧抠某个颜色"的玩法，专治下面这两种全局抠图搞不定的情况：
      </p>

      <div class="ck-help__case">
        <p class="ck-help__case-title">① 去掉画面里的水印 / 台标 / 字幕</p>
        <p class="ck-help__p">
          视频上经常带着半透明的
          logo、角标、片头字幕这类不想要的东西。如果直接加一条全局记录把这个颜色去掉，那<b>画面上所有同色的地方都会被一起抠掉</b>——比方说水印是白色，那猫身上的白毛、白爪子、白肚皮也会跟着一起没了，肯定不行。
        </p>
        <p class="ck-help__p">
          正确做法是用区域抠图把它<b>圈起来单独处理</b>：
        </p>
        <ol class="ck-help__ol">
          <li>点<b>添加抠色记录</b>加一条新的。</li>
          <li>打开它的<b>高级设置</b>。</li>
          <li>
            在左边画面里把<b>蓝色框拖到水印的位置</b>，只罩住水印那一小块。
          </li>
          <li>用<b>吸管</b>在水印上点一下取色。</li>
          <li>
            如果水印只在某些帧里露脸（比如片头三秒钟），把<b>帧段</b>设成那几帧，其他时间这条记录不工作。
          </li>
        </ol>
        <p class="ck-help__p ck-help__p--muted">
          这样水印就被擦干净了，框外面的主体一根毛都不会动。
        </p>
      </div>

      <div class="ck-help__case">
        <p class="ck-help__case-title">② 某些地方颜色太深，全局抠不干净</p>
        <p class="ck-help__p">
          绿幕拍出来的视频，<b>角落里、阴影下、褶皱处</b>常常因为光线不均，背景色比亮处<b>深一大截</b>，看起来都快变黑绿了。这时候用全局抠图会陷进两难：
        </p>
        <ul class="ck-help__ul ck-help__ul--tight">
          <li>
            容差调小一点 → 阴影里那种深绿被认为"不像背景"，留下一团绿斑没擦掉。
          </li>
          <li>
            容差调大一点 →
            阴影里的深绿是擦掉了，可主体上偏冷调、偏暗的部分（比如猫毛里的阴影）也被一起误抠，画面破破烂烂。
          </li>
        </ul>
        <p class="ck-help__p">这种情况让<b>区域抠图来补刀</b>就行：</p>
        <ol class="ck-help__ol">
          <li>
            全局那条记录的容差<b>先调到刚好不破坏主体</b>的程度，画面上残留几块深色没事。
          </li>
          <li>点<b>添加抠色记录</b>加一条新的。</li>
          <li>
            打开<b>高级设置</b>，把蓝色框拖到<b>那块还没抠干净的深色区域</b>上。
          </li>
          <li>
            用<b>吸管</b>在这片残留的深色上点一下取色，<b>容差再调大一些</b>。
          </li>
          <li>
            因为这条记录只在这个小框里干活，外面的主体根本碰不到——它只负责把这块深色"补丁"清掉。
          </li>
        </ol>
        <p class="ck-help__p ck-help__p--muted">
          如果有好几处都抠不干净，每处加一条记录、各自圈一块就行，互不影响。
        </p>
      </div>

      <h3 class="ck-help__h">其他参数</h3>
      <ul class="ck-help__ul">
        <li>
          <b>去边</b
          >：把残留的背景细边再往里削几像素，对付那种边缘还泛着一圈淡背景色的情况。0
          = 不削。
        </li>
        <li>
          <b>图片质量</b>：导出图片的清晰度，越高越清晰、文件越大。一般 80–90
          就够用。
        </li>
        <li>
          <b>剔除坏帧</b
          >：有些视频每隔一段会有一张压得比较糙的画面，抠出来边缘发毛、坑坑洼洼。打开后会自动跳过这种帧。猫咪是循环动画，丢几帧基本看不出来。
        </li>
        <li>
          <b>右侧预览</b
          >可以<b>滚轮缩放、按住拖动平移</b>，方便检查边缘细节，点右上角刷新图标恢复原视图。
        </li>
      </ul>
    </div>

    <template #footer>
      <el-button type="primary" @click="visible = false">朕知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 抠图使用说明弹框（独立组件）。
 *
 * 父组件用 v-model 控制显示：
 * `<ChromaKeyHelp v-model="helpVisible" />`
 *
 * 视觉设计（dev-tool 风格）：
 * - 大标题 `//` 前缀（mono 字体、主色、字号比标题大），仿代码注释；
 * - 有序列表序号用主色 mono 数字（无背景）；
 * - 无序列表用主色小圆点；
 * - 行内 `<b>` 仅着色不加粗，避免视觉噪音；
 * - 两个常见场景沿用浅底 + 左侧色带的简单卡片样式。
 */
const visible = defineModel<boolean>({ required: true });
</script>

<style scoped lang="scss">
/**
 * 包一层 .ck-help 做嵌套；子选择器统一打全 BEM 名（不用 &），
 * 伪元素 / 修饰类在同级写出来，descendant 自然嵌进去。
 */

.ck-help {
  .ck-help__body {
    font-size: 13px;
    line-height: 1.78;
    color: var(--el-text-color-primary);
    /* 弹框内容多，给个最大高度让 dialog 自身滚动条来兜，避免视觉冲到底。 */
    max-height: 62vh;
    overflow-y: auto;
    padding-right: 4px;

    /* 行内关键词：仅主色，不加粗，避免大段加粗视觉噪音。 */
    b {
      color: var(--el-color-primary);
      font-weight: normal;
    }
  }

  /* 开篇引导段：稍大字号、主文本色，跟正文拉开层级。 */
  .ck-help__lead {
    margin: 0 0 18px;
    font-size: 13.5px;
    line-height: 1.78;
    color: var(--el-text-color-primary);
  }

  /* 大标题：左侧主色竖条做装饰 + 底部一道虚线分割。 */
  .ck-help__h {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 24px 0 10px;
    padding-bottom: 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    border-bottom: 1px dashed var(--el-border-color-lighter);
  }

  .ck-help__h::before {
    display: block;
    content: "";
    width: 4px;
    height: 22px;
    border-radius: 2px;
    background-color: var(--el-color-primary);
  }

  /* 紧跟引导段的第一个标题缩短顶部间距。 */
  .ck-help__lead + .ck-help__h {
    margin-top: 8px;
  }

  .ck-help__p {
    margin: 6px 0 10px;
    color: var(--el-text-color-regular);
  }

  /* 段尾结论性的话用浅一档颜色 + 斜体，让前面的步骤列表更突出。 */
  .ck-help__p--muted {
    color: var(--el-text-color-secondary);
    font-style: italic;
  }

  /* 有序列表：自定义计数 + 主色 mono 数字（无背景）。 */
  .ck-help__ol {
    counter-reset: ck-step;
    list-style: none;
    padding: 0;
    margin: 6px 0 12px;

    > li {
      position: relative;
      counter-increment: ck-step;
      padding-left: 26px;
      margin-bottom: 6px;
      color: var(--el-text-color-regular);
    }

    > li::before {
      content: counter(ck-step);
      position: absolute;
      left: 4px;
      top: 4px;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--el-color-primary);
      border: 1px solid var(--el-color-primary);
      border-radius: 50%;
    }
  }

  /* 无序列表：主色小圆点。 */
  .ck-help__ul {
    list-style: none;
    padding: 0;
    margin: 6px 0 12px;

    > li {
      position: relative;
      padding-left: 18px;
      margin-bottom: 6px;
      color: var(--el-text-color-regular);
    }

    > li::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 10px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--el-color-primary);
    }
  }

  .ck-help__ul--tight > li {
    margin-bottom: 2px;
  }

  /* 两个常见场景：浅底 + 左侧主色色带的简单卡片（用回之前的样式）。 */
  .ck-help__case {
    margin: 12px 0 16px;
    padding: 10px 12px;
    background: var(--el-fill-color-light);
    border-left: 3px solid var(--el-color-primary);
    border-radius: 6px;

    /* 卡片内的有序/无序列表略紧凑，避免和卡片边距挤。 */
    .ck-help__ol,
    .ck-help__ul {
      margin: 4px 0 6px;
    }
  }

  .ck-help__case-title {
    margin: 0 0 6px;
    font-weight: 600;
    color: var(--el-color-primary);
  }
}
</style>
