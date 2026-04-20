@echo off
rem Thin wrapper that hands off to the PowerShell launcher.
rem The .ps1 is where the real logic lives; PowerShell is more predictable
rem than cmd for interactive scripts and doesn't have the batch-invocation
rem quirks that were causing cmd windows to close unexpectedly.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bot.ps1"

rem Safety net: if PowerShell itself failed to launch we still want to see
rem why, so drop to an interactive prompt here.
if errorlevel 1 (
  echo.
  echo [ERROR] PowerShell failed to run start-bot.ps1. Details above.
  cmd /k
)
