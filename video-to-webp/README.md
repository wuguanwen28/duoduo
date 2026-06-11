# 视频转透明背景WebP序列帧工具

## 功能介绍

这个工具可以将绿色背景（绿幕）的视频转换为透明背景的WebP格式连续序列帧图片。

### 适用场景
- 视频编辑合成
- 游戏精灵图制作
- 网页动效制作
- 动画制作
- 任何需要透明背景素材的场景

### 优势
- **高压缩率**：WebP比PNG小80-90%
- **透明通道**：完美保留Alpha透明度
- **批量处理**：自动处理整个视频
- **可调参数**：支持自定义绿幕检测范围

## 文件清单

```
video-to-webp/
├── video_to_webp.py      # 主程序脚本
├── run.bat               # Windows一键运行脚本
├── requirements.txt       # Python依赖列表
└── README.md            # 本说明文档
```

## 安装依赖

### 方法1：使用pip安装（推荐）

```bash
# 进入工具目录
cd D:/.workbuddy/video-to-webp

# 安装依赖
pip install -r requirements.txt
```

### 方法2：手动安装

```bash
pip install opencv-python pillow numpy
```

### 方法3：WorkBuddy环境（已预装）

如果你使用WorkBuddy，依赖已经安装好了，可以直接使用。

## 使用方法

### 方法1：命令行使用（推荐）

#### 基本用法

```bash
# 只生成WebP帧（不打包）
python video_to_webp.py "视频文件路径"

# 示例
python video_to_webp.py "C:/Users/51395/Pictures/duoduo/睡觉.mp4"
python video_to_webp.py "生成小猫眨眼视频.mp4"
```

#### 常用选项

```bash
# 生成WebP帧并打包为ZIP
python video_to_webp.py "视频.mp4" --zip

# 调整WebP质量（默认90，范围0-100，越高越好）
python video_to_webp.py "视频.mp4" --quality 95

# 指定输出目录
python video_to_webp.py "视频.mp4" "自定义输出目录"

# 组合使用
python video_to_webp.py "视频.mp4" "输出目录" --zip --quality 95
```

#### 绿幕参数调整（如果默认效果不好）

如果你的视频绿幕颜色略有不同，可以调整HSV颜色范围：

```bash
# 调整绿色检测范围（默认值适用于标准绿幕）
python video_to_webp.py "视频.mp4" --lower-h 40 --upper-h 80
```

**HSV参数说明：**
- `--lower-h/--upper-h`: 色调范围（绿色约35-85）
- `--lower-s/--upper-s`: 饱和度范围（默认40-255）
- `--lower-v/--upper-v`: 亮度范围（默认40-255）

### 方法2：使用Windows批处理脚本

1. 将 `run.bat` 复制到视频所在目录
2. 直接拖拽视频文件到 `run.bat` 上
3. 或者双击运行，按提示输入视频路径

## 输出结果

处理完成后会生成：

### 1. 序列帧文件夹
- **文件夹名**：`视频文件名_webp_frames/`
- **文件格式**：`frame_0000.webp`, `frame_0001.webp`, ...
- **特性**：带透明背景的WebP格式

### 2. ZIP压缩包（如果使用 `--zip` 选项）
- **文件名**：`视频文件名_webp_frames.zip`
- **内容**：包含所有序列帧
- **用途**：方便传输和分享

## 示例：处理你的视频

### 示例1：处理"睡觉.mp4"

```bash
cd D:/.workbuddy/video-to-webp
python video_to_webp.py "C:/Users/51395/Pictures/duoduo/睡觉.mp4" --zip
```

**输出：**
- 文件夹：`C:/Users/51395/Pictures/duoduo/睡觉_webp_frames/`
- ZIP文件：`C:/Users/51395/Pictures/duoduo/睡觉_webp_frames.zip`
- 文件大小：约6.8 MB（241帧）

### 示例2：处理"生成小猫眨眼视频.mp4"

```bash
python video_to_webp.py "C:/Users/51395/Pictures/duoduo/生成小猫眨眼视频.mp4" --zip
```

**输出：**
- 文件夹：`生成小猫眨眼视频_webp_frames/`
- ZIP文件：`生成小猫眨眼视频_webp_frames.zip`
- 文件大小：约4.5 MB（121帧）

## 输出文件说明

| 属性 | 说明 |
|------|------|
| **格式** | WebP（支持透明通道） |
| **命名** | frame_0000.webp ~ frame_NNNN.webp |
| **帧率** | 与原始视频相同（通常24FPS） |
| **分辨率** | 与原始视频相同 |
| **压缩率** | 比PNG小80-90% |

## 常见问题

### Q1: 生成的帧有绿色边缘怎么办？

**解决方法：**调整HSV参数，缩小绿色检测范围：

```bash
python video_to_webp.py "视频.mp4" --lower-h 40 --upper-h 80 --lower-s 60
```

### Q2: 人物/物体内部有空洞怎么办？

**解决方法：**降低S和V的下限：

```bash
python video_to_webp.py "视频.mp4" --lower-s 30 --lower-v 30
```

### Q3: WebP文件太大怎么办？

**解决方法：**降低质量参数：

```bash
python video_to_webp.py "视频.mp4" --quality 80
```

### Q4: 如何处理非绿色背景的视频？

**解决方法：**目前脚本针对绿色背景优化。如果需要处理其他颜色背景，可以：
1. 修改HSV参数范围（如蓝色背景H约100-130）
2. 或使用色度键工具手动调整
3. 或联系我帮你调整脚本

### Q5: 处理速度太慢怎么办？

**说明：**处理速度取决于：
- 视频分辨率和帧数
- 电脑性能
- WebP压缩质量

**建议：**
- 降低 `--quality` 参数可加快速度
- 使用SSD硬盘可提升速度

### Q6: 进度条显示乱码怎么办？

**说明：**这是Windows控制台编码问题，不影响功能。

**解决方法：**
- 脚本已使用ASCII字符，应该不会乱码
- 如果还有问题，可以禁用进度条显示

## 高级用法

### 批量处理多个视频

创建一个批处理脚本 `batch_process.bat`：

```batch
@echo off
chcp 65001 >nul

for %%f in (*.mp4) do (
    echo Processing: %%f
    python video_to_webp.py "%%f" --zip
)

echo All done!
pause
```

### 自定义绿幕颜色

如果你的绿幕不是标准绿色，可以用图像编辑软件查看背景颜色，然后调整参数：

```bash
# 例如：浅绿色背景
python video_to_webp.py "视频.mp4" --lower-h 30 --upper-h 90 --lower-s 30
```

## 技术细节

### 依赖库
- **OpenCV** (`cv2`)：视频读取和颜色空间转换
- **Pillow** (`PIL`)：图像处理和WebP保存
- **NumPy**：数组操作和掩码处理

### 处理流程
1. 读取视频文件
2. 逐帧转换为HSV颜色空间
3. 创建绿色掩码（色度键）
4. 形态学操作优化边缘
5. 添加Alpha透明通道
6. 保存为WebP格式

### HSV颜色空间
- **H (Hue)**：色调，0-180（OpenCV中）
- **S (Saturation)**：饱和度，0-255
- **V (Value)**：亮度，0-255

## 更新日志

### v1.0 (2026-06-11)
- ✅ 初始版本发布
- ✅ 支持绿色背景移除
- ✅ 支持WebP格式输出
- ✅ 支持ZIP打包
- ✅ 支持自定义HSV参数
- ✅ 修复Windows编码问题

## 许可证

本工具由WorkBuddy AI Assistant创建，可自由使用和修改。

## 联系支持

如果在使用过程中遇到问题，可以：
1. 查看脚本输出的错误信息
2. 调整HSV参数重新处理
3. 向我（WorkBuddy）寻求帮助，提供：
   - 视频样本
   - 错误描述
   - 使用的命令

---

**制作日期**: 2026-06-11  
**版本**: 1.0  
**作者**: WorkBuddy AI Assistant  
**最后更新**: 2026-06-11
