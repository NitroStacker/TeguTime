@echo off
rem ASCII-only to avoid OEM codepage issues.
rem Launches the bot in a NEW cmd window that stays open regardless of
rem what happens (cmd /k). If anything goes wrong the user sees the error
rem there; this outer wrapper also writes a diagnostic log in case the
rem new window also disappears somehow.

cd /d "%~dp0"

set "LOG=%~dp0start-bot.log"

echo ==== TeguTime bot launcher ==== > "%LOG%"
echo Time: %DATE% %TIME% >> "%LOG%"
echo CD:   %CD% >> "%LOG%"
echo --- node --- >> "%LOG%"
node -v >> "%LOG%" 2>&1
echo --- pnpm --- >> "%LOG%"
pnpm -v >> "%LOG%" 2>&1
echo --- launching bot window --- >> "%LOG%"

echo Launching TeguTime bot in a new window...
start "TeguTime Bot" cmd /k "cd /d %~dp0 & echo Starting TeguTime... & echo. & pnpm start & echo. & echo Bot has exited. Close this window when you are done."

echo.
echo If no window appeared, check start-bot.log in this folder.
timeout /t 3 /nobreak >nul
