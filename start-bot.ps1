# PowerShell launcher for the TeguTime bot.
# Uses PowerShell instead of cmd.exe because cmd has inconsistent
# behavior around nested batch invocations and interactive pauses.

Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  TeguTime Discord Bot" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host ("Working directory: {0}" -f (Get-Location))
Write-Host ""

try {
  Write-Host ("Node: {0}" -f (node -v))
  Write-Host ("pnpm: {0}" -f (pnpm -v))
} catch {
  Write-Host "[ERROR] node or pnpm not found on PATH." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "Press Enter to close this window."
  $null = Read-Host
  exit 1
}

Write-Host ""
Write-Host "Starting the bot. Minimize this window; closing it stops the bot." -ForegroundColor Green
Write-Host "==========================================="
Write-Host ""

# Run pnpm start in-process so its output streams live into this window.
& pnpm start
$code = $LASTEXITCODE

Write-Host ""
Write-Host "===========================================" -ForegroundColor Yellow
Write-Host ("  Bot exited with code {0}" -f $code) -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "If the bot crashed, scroll up to see the error."
Write-Host "Press Enter to close this window."
$null = Read-Host
