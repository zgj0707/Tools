@echo off
rem ============================================================
rem  视频拉片 · 镜头检测抽帧小程序 —— 启动脚本（可移植版）
rem  启动 Web 界面（本机服务，自动在新窗口中打开）
rem  优先使用项目内 .venv（由 setup.bat 创建）；
rem  找不到时回退到 ../pyscenedetect-env（仅兼容本项目开发机）。
rem ============================================================
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\pythonw.exe"
if not exist "%PY%" set "PY=%~dp0..\pyscenedetect-env\Scripts\pythonw.exe"

if not exist "%PY%" (
  echo [错误] 未找到 Python 环境。
  echo        请先双击运行 setup.bat 完成安装，然后再启动本脚本。
  pause
  exit /b 1
)

start "" "%PY%" "%~dp0webapp.py"
