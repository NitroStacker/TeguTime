@echo off
rem Minimal launcher. Stays ASCII-only to avoid OEM-codepage issues.

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
rem `start` inherits our CWD, so no need to cd again inside /k. Keeping
rem the /k argument to a single bare command avoids nested-quote parsing
rem issues. `pnpm start` runs; when it exits, /k keeps the window open.
start "TeguTime Bot" cmd /k pnpm start

echo.
echo A new "TeguTime Bot" window should be open now.
echo If no window appeared, open start-bot.log in this folder.
timeout /t 5 /nobreak >nul
