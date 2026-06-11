@echo off
chcp 65001 >nul
REM 视频转透明WebP序列帧工具 - Windows启动脚本

set PYTHON_PATH=C:\Users\51395\.workbuddy\binaries\python\versions\3.13.12\python.exe
set SCRIPT_PATH=%~dp0video_to_webp.py

echo.
echo ==========================================
echo 视频转透明背景WebP序列帧工具
echo ==========================================
echo.

if "%~1"=="" (
    echo 使用方法：
    echo   %~nx0 "视频文件路径" [选项]
    echo.
    echo 示例：
    echo   %~nx0 "C:\Users\51395\Pictures\duoduo\睡觉.mp4"
    echo   %~nx0 "睡觉.mp4" --zip
    echo.
    echo 选项：
    echo   --zip            打包为ZIP文件
    echo   --quality 90     WebP质量(0-100，默认90^)
    echo   --help           显示完整帮助
    echo.
    pause
    exit /b 1
)

set VIDEO_PATH=%~1
shift

echo 正在处理视频：%VIDEO_PATH%
echo.

"%PYTHON_PATH%" "%SCRIPT_PATH%" "%VIDEO_PATH%" %*

echo.
echo 处理完成！
pause
