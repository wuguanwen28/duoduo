#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
视频转透明背景WebP序列帧工具
适用于绿色背景（绿幕）视频

使用方法：
    python video_to_webp.py <视频路径> [输出目录] [--zip]

参数说明：
    视频路径    : 输入视频文件路径（必需）
    输出目录    : 输出目录路径（可选，默认为视频同目录下的输出文件夹）
    --zip      : 是否打包为ZIP文件

示例：
    python video_to_webp.py "C:/Users/51395/Pictures/duoduo/睡觉.mp4"
    python video_to_webp.py "睡觉.mp4" "输出目录" --zip
"""

import cv2
import os
import sys
import numpy as np
from PIL import Image
import zipfile
import argparse
import time
import io

def setup_encoding():
    """设置控制台输出编码，解决Windows下中文乱码问题"""
    # 尝试设置UTF-8编码
    if sys.platform == 'win32':
        try:
            # 尝试重新配置stdout为UTF-8
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
        except:
            pass

def print_progress(current, total, prefix='', suffix='', length=40):
    """显示进度条（使用ASCII字符避免编码问题）"""
    try:
        percent = (current / total) * 100 if total > 0 else 0
        filled = int(length * current // total) if total > 0 else 0
        bar = '#' * filled + '.' * (length - filled)
        sys.stdout.write(f'\r{prefix} |{bar}| {current}/{total} ({percent:.1f}%) {suffix}')
        sys.stdout.flush()
        if current == total:
            sys.stdout.write('\n')
    except:
        # 如果进度条出错，只打印简单信息
        if current % 10 == 0 or current == total:
            print(f"{prefix} {current}/{total} ({percent:.1f}%)")

# 默认清除区域：豆包 AI 生成视频的「豆包AI生成」水印。
# 该水印会在画面内移动——左上角与右下角各出现一段时间。经对 feed.mp4
# 逐帧核对，这两个角落始终没有猫，故全程清除两处即可、无需限定时间段。
# 用百分比表示，重导出成任意分辨率也能对齐。坐标：x1,y1,x2,y2[@起-止]
DEFAULT_CLEAR_REGIONS = [
    '0,0,20%,9%',          # 左上角水印（含余量）
    '81%,90%,100%,100%',   # 右下角水印（含余量）
]

def remove_green_screen(frame, lower_green=None, upper_green=None):
    """
    移除绿色背景，返回带透明通道的图像
    
    参数：
        frame: OpenCV读取的视频帧（BGR格式）
        lower_green: HSV颜色空间下绿色下限，默认[35, 40, 40]
        upper_green: HSV颜色空间下绿色上限，默认[85, 255, 255]
    
    返回：
        RGBA格式的numpy数组
    """
    if lower_green is None:
        lower_green = np.array([35, 40, 40])  # H, S, V下限
    if upper_green is None:
        upper_green = np.array([85, 255, 255])  # H, S, V上限
    
    # 转换到HSV颜色空间（更容易分离绿色）
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    
    # 创建绿色掩码
    mask = cv2.inRange(hsv, lower_green, upper_green)
    
    # 形态学操作：去除噪点，填充空洞
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    
    # 反色掩码（前景为白色）
    mask_inv = cv2.bitwise_not(mask)
    
    # 转换为RGB并添加Alpha通道
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    rgba = np.dstack((frame_rgb, mask_inv))
    
    return rgba

def parse_rect(spec, width, height):
    """
    把 "x1,y1,x2,y2" 形式的区域字符串解析为像素矩形 (x1, y1, x2, y2)。

    每个数值支持两种写法：
        - 像素：直接写数字，如 120
        - 百分比：带 % 号，按画面宽/高换算，如 80%
    解析后会自动规整左上/右下顺序，并裁剪到画面范围内。
    """
    parts = [p.strip() for p in spec.split(',')]
    if len(parts) != 4:
        raise ValueError(f"区域格式应为 x1,y1,x2,y2，收到: {spec}")

    # x 用宽度换算百分比，y 用高度换算
    dims = [width, height, width, height]
    coords = []
    for p, dim in zip(parts, dims):
        if p.endswith('%'):
            coords.append(int(round(float(p[:-1]) / 100.0 * dim)))
        else:
            coords.append(int(round(float(p))))

    x1, y1, x2, y2 = coords
    # 规整顺序（允许用户随意写两个角），再裁剪到画面内
    x1, x2 = sorted((x1, x2))
    y1, y2 = sorted((y1, y2))
    x1 = max(0, min(x1, width))
    x2 = max(0, min(x2, width))
    y1 = max(0, min(y1, height))
    y2 = max(0, min(y2, height))
    return x1, y1, x2, y2

def _to_frame(token, fps, default):
    """把单个时间端点换算成帧号。空串取默认值；带 f 后缀按帧，否则按秒。"""
    token = token.strip()
    if token == '':
        return default
    if token.endswith('f'):
        return int(round(float(token[:-1])))
    # 否则视为秒，乘以 fps 换算成帧
    return int(round(float(token) * fps))

def parse_time_range(time_part, fps, frame_count):
    """
    解析时间段字符串 "起-止" 为帧区间 (frame_start, frame_end)，左闭右开。

    每端支持：秒（如 2、1.5）、帧（数字后加 f，如 30f）、或留空取默认。
    空字符串表示「整段视频」。
    """
    # 没有时间段 = 全程生效
    end_default = frame_count if frame_count > 0 else 10 ** 9
    if time_part.strip() == '':
        return 0, end_default
    if '-' not in time_part:
        raise ValueError(f"时间段格式应为 起-止，收到: {time_part}")

    start_tok, end_tok = time_part.split('-', 1)
    fstart = _to_frame(start_tok, fps, 0)
    fend = _to_frame(end_tok, fps, end_default)
    if fend < fstart:
        fstart, fend = fend, fstart
    return max(0, fstart), fend

def parse_clear_spec(spec, width, height, fps, frame_count):
    """
    解析单条清除指令，格式： x1,y1,x2,y2[@起-止]

    位置部分 x1,y1,x2,y2：像素或百分比（带 %），见 parse_rect。
    时间部分（可选，@ 之后）：限定该区域只在这段时间内清除；不写则全程生效。

    返回 (x1, y1, x2, y2, frame_start, frame_end)。
    """
    if '@' in spec:
        rect_part, time_part = spec.split('@', 1)
    else:
        rect_part, time_part = spec, ''
    x1, y1, x2, y2 = parse_rect(rect_part, width, height)
    fstart, fend = parse_time_range(time_part, fps, frame_count)
    return x1, y1, x2, y2, fstart, fend

def clear_regions(rgba, rects, frame_num):
    """
    把指定矩形区域的 Alpha 通道置 0（完全透明），用于抹掉固定位置的水印 / 文字。
    仅当当前帧号落在该区域的生效时间段内才清除。

    参数：
        rgba     : RGBA 格式的 numpy 数组（remove_green_screen 的输出）
        rects    : 区域列表 [(x1, y1, x2, y2, frame_start, frame_end), ...]
        frame_num: 当前帧号（从 0 开始）
    """
    for (x1, y1, x2, y2, fstart, fend) in rects:
        if frame_num < fstart or frame_num >= fend:
            continue  # 不在该区域的生效时间段内
        if x2 > x1 and y2 > y1:
            rgba[y1:y2, x1:x2, 3] = 0  # 第 4 通道即 Alpha
    return rgba

def process_video(video_path, output_dir=None, create_zip=False,
                  lower_green=None, upper_green=None, webp_quality=90,
                  clear_specs=None):
    """
    处理视频，生成透明背景WebP序列帧
    
    参数：
        video_path: 视频文件路径
        output_dir: 输出目录（None则自动生成）
        create_zip: 是否打包为ZIP
        lower_green: 绿色下限（HSV）
        upper_green: 绿色上限（HSV）
        webp_quality: WebP质量（0-100，默认90）
        clear_specs: 需清除（置透明）的区域字符串列表，格式见 parse_rect；None 表示不清除

    返回：
        (成功帧数, 总帧数, 输出目录, ZIP路径)
    """
    # 检查视频文件
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
    
    # 自动生成输出目录
    if output_dir is None:
        video_name = os.path.splitext(os.path.basename(video_path))[0]
        output_dir = os.path.join(os.path.dirname(os.path.abspath(video_path)), f"{video_name}_webp_frames")
    
    os.makedirs(output_dir, exist_ok=True)
    
    # 打开视频
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    
    # 获取视频信息
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    print(f"\n{'='*60}")
    print(f"Video Information:")
    print(f"  Resolution: {width}x{height}")
    print(f"  FPS: {fps}")
    print(f"  Total Frames: {frame_count}")
    print(f"  Output Directory: {output_dir}")
    print(f"{'='*60}\n")

    # 解析需要清除的区域（此时已知画面宽高与 fps，才能换算百分比和时间段）
    clear_rects = []
    if clear_specs:
        for spec in clear_specs:
            clear_rects.append(parse_clear_spec(spec, width, height, fps, frame_count))
        print("Clear regions (px x1,y1,x2,y2 @ frame[start,end)):")
        for (x1, y1, x2, y2, fstart, fend) in clear_rects:
            print(f"  ({x1},{y1},{x2},{y2}) @ [{fstart}, {fend})")
        print()

    # 处理每一帧
    frame_num = 0
    start_time = time.time()
    success_count = 0
    fail_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        try:
            # 移除绿色背景
            rgba = remove_green_screen(frame, lower_green, upper_green)

            # 按区域清除（抹掉左下/右上等固定位置的文字水印，按时间段生效）
            if clear_rects:
                rgba = clear_regions(rgba, clear_rects, frame_num)

            # 保存为WebP
            img = Image.fromarray(rgba)
            output_path = os.path.join(output_dir, f"frame_{frame_num:04d}.webp")
            img.save(output_path, 'WEBP', quality=webp_quality, method=6)
            
            # 验证文件是否成功保存
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                success_count += 1
            else:
                raise Exception("File save failed or empty")
            
            frame_num += 1
            
            # 更新进度条
            if frame_count > 0:
                print_progress(frame_num, frame_count, 
                             prefix='Processing:', suffix='frames')
        
        except Exception as e:
            print(f"\nError processing frame {frame_num}: {e}", file=sys.stderr)
            fail_count += 1
            frame_num += 1
            
            # 删除可能损坏的文件
            bad_file = os.path.join(output_dir, f"frame_{frame_num-1:04d}.webp")
            if os.path.exists(bad_file) and os.path.getsize(bad_file) == 0:
                try:
                    os.remove(bad_file)
                except:
                    pass
    
    cap.release()
    
    # 计算耗时
    elapsed = time.time() - start_time
    print(f"\n\nProcessing Complete!")
    print(f"  Success: {success_count} frames")
    if fail_count > 0:
        print(f"  Failed: {fail_count} frames")
    print(f"  Time Elapsed: {elapsed:.1f} seconds")
    print(f"  Output Directory: {output_dir}")
    
    # 计算文件大小
    webp_files = [f for f in os.listdir(output_dir) if f.endswith('.webp')]
    if webp_files:
        total_size = sum(os.path.getsize(os.path.join(output_dir, f)) for f in webp_files)
        print(f"  Total Size: {total_size / 1024 / 1024:.1f} MB")
    
    # 打包为ZIP
    zip_path = None
    if create_zip and webp_files:
        zip_path = f"{output_dir}.zip"
        print(f"\nPacking ZIP file...")
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for i, filename in enumerate(sorted(webp_files)):
                file_path = os.path.join(output_dir, filename)
                zipf.write(file_path, filename)
                if (i + 1) % 50 == 0:
                    print(f"  Packing progress: {i + 1}/{len(webp_files)}")
        
        zip_size = os.path.getsize(zip_path)
        print(f"  ZIP File: {zip_path}")
        print(f"  ZIP Size: {zip_size / 1024 / 1024:.1f} MB")
    
    return success_count, frame_count, output_dir, zip_path

def main():
    """主函数"""
    setup_encoding()
    
    parser = argparse.ArgumentParser(
        description='Video to Transparent WebP Frames Tool',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python video_to_webp.py "video.mp4"
  python video_to_webp.py "video.mp4" "output_dir" --zip
  python video_to_webp.py "video.mp4" --zip --quality 95
        """
    )
    
    parser.add_argument('video', help='Input video file path')
    parser.add_argument('output', nargs='?', default=None, help='Output directory (optional)')
    parser.add_argument('--zip', action='store_true', help='Pack into ZIP file')
    parser.add_argument('--quality', type=int, default=90, help='WebP quality (0-100, default 90)')
    parser.add_argument('--lower-h', type=int, default=35, help='Green HSV lower H (default 35)')
    parser.add_argument('--lower-s', type=int, default=40, help='Green HSV lower S (default 40)')
    parser.add_argument('--lower-v', type=int, default=40, help='Green HSV lower V (default 40)')
    parser.add_argument('--upper-h', type=int, default=85, help='Green HSV upper H (default 85)')
    parser.add_argument('--upper-s', type=int, default=255, help='Green HSV upper S (default 255)')
    parser.add_argument('--upper-v', type=int, default=255, help='Green HSV upper V (default 255)')
    parser.add_argument('--clear-rect', action='append', default=None, metavar='x1,y1,x2,y2[@起-止]',
                        help='清除（置透明）一个矩形区域，可重复指定多个。'
                             '坐标支持像素或百分比（带%%）；可选 @起-止 限定生效时间段'
                             '（秒，或数字后加 f 表示帧，任意一端可留空）。'
                             '不指定时使用默认水印区域（左上+右下）。'
                             '例: --clear-rect 0,80%%,25%%,100%% '
                             '--clear-rect 75%%,0,100%%,15%%@0-3 '
                             '--clear-rect 0,80%%,25%%,100%%@30f-90f')
    parser.add_argument('--no-clear', action='store_true',
                        help='不清除任何区域（关闭默认水印清除）')

    args = parser.parse_args()

    # 决定清除区域：未显式指定 --clear-rect 时用默认水印区域；--no-clear 则全关。
    if args.no_clear:
        clear_specs = None
    elif args.clear_rect is not None:
        clear_specs = args.clear_rect
    else:
        clear_specs = DEFAULT_CLEAR_REGIONS
    
    # 设置绿色范围
    lower_green = np.array([args.lower_h, args.lower_s, args.lower_v])
    upper_green = np.array([args.upper_h, args.upper_s, args.upper_v])
    
    print(f"\nGreen screen detection range (HSV):")
    print(f"  Lower: H={args.lower_h}, S={args.lower_s}, V={args.lower_v}")
    print(f"  Upper: H={args.upper_h}, S={args.upper_s}, V={args.upper_v}")
    
    try:
        # 处理视频
        frame_num, total, output_dir, zip_path = process_video(
            video_path=args.video,
            output_dir=args.output,
            create_zip=args.zip,
            lower_green=lower_green,
            upper_green=upper_green,
            webp_quality=args.quality,
            clear_specs=clear_specs
        )
        
        print(f"\n{'='*60}")
        print(f"All Done!")
        if zip_path:
            print(f"  ZIP File: {zip_path}")
        print(f"{'='*60}\n")
        
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
