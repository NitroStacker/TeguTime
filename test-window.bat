@echo off
rem Diagnostic: double-click this and see if ANY cmd window stays open.
rem If this also closes immediately, something on your system is killing
rem cmd windows spawned from Explorer (AV, group policy, etc.) and the
rem PowerShell launcher is the way to go.

echo.
echo If you can read this, cmd windows work fine from double-click.
echo.
echo Press any key to close.
pause >nul
