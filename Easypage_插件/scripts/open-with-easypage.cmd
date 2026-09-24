@echo off
rem ============================================================================
rem 易页 EasyPage · 双击入口
rem ----------------------------------------------------------------------------
rem 只做一件事：找到 node，把参数转交给 open-with-easypage.mjs。
rem 全部逻辑都在 .mjs 里 —— 批处理写不了可测试的逻辑，而「挑哪个浏览器」
rem 这件事恰恰需要被实测（Chrome 137+ 已忽略 --load-extension，静默失败）。
rem
rem 用法：把要编辑的 html 拖到这个 .cmd 上，或
rem        scripts\open-with-easypage.cmd "C:\path\to\page.html"
rem ============================================================================
setlocal

set "HERE=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] PATH 里没有 node。
  echo     可改用:  node "%HERE%open-with-easypage.mjs" ^<page.html^>
  pause
  exit /b 1
)

node "%HERE%open-with-easypage.mjs" %*

if errorlevel 1 (
  echo.
  pause
)

endlocal
