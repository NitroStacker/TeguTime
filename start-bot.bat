@echo off
title TeguTime Bot
cd /d "%~dp0"

echo.
echo  ===========================================
echo    TeguTime Discord Bot
echo  ===========================================
echo.
echo  Working directory: %CD%
echo.

echo  Node version:
node --version
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js is not installed or not on PATH.
  echo  Install it from https://nodejs.org/ and try again.
  goto HOLD
)

echo  pnpm version:
pnpm --version
if errorlevel 1 (
  echo.
  echo  [ERROR] pnpm is not installed or not on PATH.
  echo  Run this once in a new cmd window:   npm install -g pnpm
  echo  Then restart Explorer (or log out and back in) so PATH refreshes.
  goto HOLD
)

echo.
echo  Starting the bot — MINIMIZE this window; closing it stops the bot.
echo  ===========================================
echo.

call pnpm start

echo.
echo  ===========================================
echo    Bot exited with code %ERRORLEVEL%.
echo  ===========================================

:HOLD
echo.
echo  This window will stay open so you can see any errors above.
echo  Close it to fully exit, or type  exit  and press Enter.
echo.
cmd /k
