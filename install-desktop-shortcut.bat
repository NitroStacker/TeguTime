@echo off
setlocal

set "BAT=%~dp0start-bot.bat"
set "LNK=%USERPROFILE%\Desktop\TeguTime Bot.lnk"

echo Creating desktop shortcut...
echo   Target:   %BAT%
echo   Shortcut: %LNK%
echo.

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%BAT%'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='imageres.dll,-1023'; $s.Description='Start the TeguTime Discord bot'; $s.Save()"

if errorlevel 1 (
  echo.
  echo [ERROR] Failed to create the shortcut.
  pause
  exit /b 1
)

echo.
echo Done. Double-click "TeguTime Bot" on your desktop any time to start the bot.
echo.
pause
