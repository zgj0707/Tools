@echo off
rem ============================================================
rem  视频拉片 · 镜头检测抽帧小程序 —— 一键安装脚本（可移植版）
rem  作用：在项目内创建 .venv 环境并安装全部依赖
rem  要求：已安装 Python 3.10+（python.org 官方版，含 tkinter）
rem ============================================================
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 python 命令。
  echo        请先从 https://www.python.org/downloads/ 安装 Python 3.10+，
  echo        安装时务必勾选 "Add python.exe to PATH"，然后重新运行本脚本。
  pause
  exit /b 1
)

echo [1/3] 创建虚拟环境 .venv ...
python -m venv .venv
if errorlevel 1 (
  echo [错误] 虚拟环境创建失败。
  pause
  exit /b 1
)

echo [2/3] 升级 pip ...
".venv\Scripts\python.exe" -m pip install --upgrade pip

echo [3/3] 安装依赖（scenedetect 等，约 1-3 分钟）...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  安装完成！双击 run.bat 即可启动小程序。
echo ============================================================
pause
