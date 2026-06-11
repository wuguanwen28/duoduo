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

def process_video(video_path, output_dir=None, create_zip=False, 
                  lower_green=None, upper_green=None, webp_quality=90):
    """
    处理视频，生成透明背景WebP序列帧
    
    参数：
        video_path: 视频文件路径
        output_dir: 输出目录（None则自动生成）
        create_zip: 是否打包为ZIP
        lower_green: 绿色下限（HSV）
        upper_green: 绿色上限（HSV）
        webp_quality: WebP质量（0-100，默认90）
    
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
    
    args = parser.parse_args()
    
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
            webp_quality=args.quality
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
