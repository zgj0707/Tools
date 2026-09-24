@echo off
rem ============================================================================
rem EasyPage - Gate G1: confirm the "save as a self-contained copy" (manual step)
rem ----------------------------------------------------------------------------
rem NB: the FILE NAME is historical. This gate has NOT written back to the
rem original file since P0-8. Current behaviour (P0-9): the original file is
rem never touched; the edited copy is written NEXT TO it as "<name>_改.html"
rem (numbered suffix if that name is taken), and every rendering dependency
rem (css / js / images, including ones in subfolders) is INLINED into that copy
rem so it can be shared on its own.
rem
rem Why a .cmd: the last step of saving (native directory dialog + save dialog
rem -> user picks the folder -> browser writes to disk) cannot be automated.
rem Playwright and CDP both cannot touch an OS-level dialog. This script reduces
rem the human part to three clicks and then verifies the result by reading the
rem files back from disk AND by re-opening the copy from a folder that holds
rem nothing but that one file.
rem
rem Double-click this file, OR run from anywhere:
rem     "C:\...\new-chat\verify-writeback.cmd"
rem It cd's to its own folder first, so the current directory does not matter.
rem
rem ASCII only on purpose: a .cmd with non-ASCII paths gets its encoding mangled
rem on some Windows setups, which silently breaks cd / node invocation.
rem ============================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] node not found on PATH. Install Node.js, or run manually:
  echo     npm run build:extension
  echo     node qa\probes\p0-9-manual-copy-save.mjs
  pause
  exit /b 1
)

echo Building extension ...
call npm run build:extension
if errorlevel 1 (
  echo.
  echo [x] Build failed. Fix the errors above, then run this file again.
  pause
  exit /b 1
)

echo.
echo Self-testing the gate's own judgements (no human, no browser needed) ...
node "%~dp0qa\probes\p0-9-manual-copy-save.mjs" --self-test
if errorlevel 1 (
  echo.
  echo [x] The gate's judgements are not discriminating. Fix the probe first -
  echo     do NOT run the manual round: a wrong regex there looks like a
  echo     product bug and costs you a full manual pass for nothing.
  pause
  exit /b 1
)

echo.
node "%~dp0qa\probes\p0-9-manual-copy-save.mjs"

echo.
pause
endlocal
