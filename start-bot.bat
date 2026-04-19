@echo off
setlocal

title TeguTime Bot
cd /d "%~dp0"

echo.
echo  ===========================================
echo    TeguTime Discord Bot
echo  ===========================================
echo.
echo  Working directory: %CD%
echo.

rem Check Node.js is on PATH
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed or not on PATH.
  echo  Install it from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

rem Check pnpm is on PATH
where pnpm >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] pnpm is not installed.
  echo  Run:  npm install -g pnpm
  echo.
  pause
  exit /b 1
)

echo  Node:
node --version
echo  pnpm:
pnpm --version
echo.
echo  Starting the bot (press Ctrl+C in this window to stop it)...
echo  ===========================================
echo.

call pnpm start

echo.
echo  ===========================================
echo    Bot has exited.
echo  ===========================================
echo.
echo  If the bot crashed, scroll up to see the error.
echo  Press any key to close this window.
pause >nul
