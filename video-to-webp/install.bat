@echo off
chcp 65001 >nul
REM 视频转透明WebP工具 - 依赖安装脚本

echo ==========================================
echo 视频转透明WebP工具 - 依赖安装
echo ==========================================
echo.

REM 设置Python路径（WorkBuddy环境）
set PYTHON_PATH=C:\Users\51395\.workbuddy\binaries\python\versions\3.13.12\python.exe

REM 检查Python是否可用
if not exist "%PYTHON_PATH%" (
    echo [警告] WorkBuddy Python未找到，尝试使用系统Python...
    set PYTHON_PATH=python
)

echo 正在检查Python...
"%PYTHON_PATH%" --version
if errorlevel 1 (
    echo [错误] 未找到Python！请安装Python 3.7或更高版本。
    pause
    exit /b 1
)

echo.
echo 正在安装依赖包...
echo ==========================================
echo.

REM 安装依赖
"%PYTHON_PATH%" -m pip install opencv-python pillow numpy -i https://pypi.tuna.tsinghua.edu.cn/simple/

echo.
echo ==========================================
if errorlevel 1 (
    echo [失败] 依赖安装失败，请检查网络连接或手动安装。
) else (
    echo [成功] 依赖安装完成！
)
echo ==========================================
echo.

REM 验证安装
echo 正在验证安装...
"%PYTHON_PATH%" -c "import cv2, PIL, numpy; print('OpenCV:', cv2.__version__); print('Pillow:', PIL.__version__); print('NumPy:', numpy.__version__)"

echo.
pause
