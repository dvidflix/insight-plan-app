<# : batch part (PowerShell reads this as a comment)
@echo off
REM Creates "Insight Plan" shortcuts (Desktop and Start menu) that start the
REM app from this folder, with the app's icon. Double-click it. Safe to run
REM again. Then right-click a shortcut > Pin to taskbar.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:IP_ROOT = '%~dp0..'; & ([scriptblock]::Create((Get-Content -LiteralPath '%~f0' -Raw)))"
echo.
pause
exit /b
#>

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $env:IP_ROOT).Path
# Through cmd.exe, not the .bat itself: Windows only pins shortcuts to programs.
# Minimised: the server window stays in the taskbar, the app opens in the browser.
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $link = $shell.CreateShortcut((Join-Path $dir 'Insight Plan.lnk'))
  $link.TargetPath = $env:ComSpec
  $link.Arguments = "/c `"`"$root\Autorun.bat`"`""
  $link.WorkingDirectory = $root
  $link.Description = 'Start Insight Plan'
  $link.IconLocation = "$root\setup\insight-plan.ico,0"
  $link.WindowStyle = 7
  $link.Save()
}
Write-Host "Shortcuts created on the Desktop and in the Start menu, starting $root\Autorun.bat." -ForegroundColor Green
Write-Host 'To pin it: right-click the Desktop shortcut > Show more options > Pin to taskbar,'
Write-Host 'or find "Insight Plan" in the Start menu, right-click > Pin to taskbar.'
