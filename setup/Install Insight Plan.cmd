<# : batch part (PowerShell reads this as a comment)
@echo off
REM Insight Plan installer. Double-click it. Safe to run again: it repairs
REM or updates what is missing. See README > Setting up on a new laptop.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Get-Content -LiteralPath '%~f0' -Raw)))"
echo.
pause
exit /b
#>

# ---------------------------------------------------------------------------
# What it does, in order:
#   1. Git, Node.js (22.5 or later) and Python 3.12, with winget, if missing
#   2. The app from GitHub into %USERPROFILE%\Insight Plan (a private repo:
#      the first time, Git opens the browser to sign in to GitHub)
#   3. The app's packages (npm) and the Scenarios generator's (pip)
#   4. SCENARIO_PYTHON, so the app uses that Python
#   5. "Insight Plan" shortcuts on the Desktop and in the Start menu
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/dvidflix/insight-plan-app.git'
$Target = Join-Path $env:USERPROFILE 'Insight Plan'

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Winget($verb, $id, $name) {
  if (-not (Has 'winget')) {
    throw "winget (App Installer, from the Microsoft Store) is not available. Install $name yourself, then run this again."
  }
  Write-Host "   $verb $name with winget (Windows may ask for permission)..."
  & winget $verb --id $id --exact --source winget --accept-package-agreements --accept-source-agreements --silent
  Refresh-Path
}
function Node-Ok {
  if (-not (Has 'node')) { return $false }
  try { return [version]((node -v).TrimStart('v')) -ge [version]'22.5.0' } catch { return $false }
}
function Find-Python {
  foreach ($try in 'py -3.12', 'python3.12', 'python') {
    $parts = $try -split ' '
    if (-not (Has $parts[0])) { continue }
    try {
      # No double quotes in the code: Windows PowerShell drops them from native arguments.
      $pyArgs = @($parts | Select-Object -Skip 1) + @('-c', 'import sys; print(sys.executable if sys.version_info[:2] == (3, 12) else 0)')
      $exe = (& $parts[0] @pyArgs 2>$null | Select-Object -Last 1)
      if ($exe -and (Test-Path $exe)) { return $exe.Trim() }
    } catch { }
  }
  return $null
}

try {
  Write-Host 'Insight Plan setup' -ForegroundColor White
  Write-Host "Installs into: $Target"

  Step 'Git'
  if (-not (Has 'git')) { Winget 'install' 'Git.Git' 'Git' }
  if (-not (Has 'git')) { throw 'Git did not install - install it from https://git-scm.com and run this again.' }
  Ok (git --version)

  Step 'Node.js'
  if (-not (Node-Ok)) {
    if (Has 'node') { Winget 'upgrade' 'OpenJS.NodeJS.LTS' 'Node.js LTS' } else { Winget 'install' 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
  }
  if (-not (Node-Ok)) { throw 'Node.js 22.5 or later is needed - install the LTS version from https://nodejs.org and run this again.' }
  Ok "Node.js $(node -v)"

  Step 'Python 3.12 (for Scenarios)'
  $python = Find-Python
  if (-not $python) { Winget 'install' 'Python.Python.3.12' 'Python 3.12'; $python = Find-Python }
  if (-not $python) { throw 'Python 3.12 did not install - install it from https://www.python.org and run this again.' }
  Ok $python

  Step 'Insight Plan (from GitHub)'
  if (Test-Path (Join-Path $Target '.git')) {
    Write-Host '   Already installed - getting the latest version...'
    git -C $Target pull --ff-only
    if ($LASTEXITCODE -ne 0) { Write-Host '   Could not update (see above); keeping the version installed.' -ForegroundColor Yellow }
  } else {
    if ((Test-Path $Target) -and (Get-ChildItem $Target -Force | Select-Object -First 1)) {
      throw "$Target exists and is not an Insight Plan install. Move or rename it, then run this again."
    }
    Write-Host '   Downloading (the first time, a browser window asks you to sign in to GitHub)...'
    git clone $RepoUrl $Target
    if ($LASTEXITCODE -ne 0) { throw 'Could not download the app. Check that you accepted the GitHub invitation to the insight-plan-app repository, then run this again.' }
  }
  Ok 'Done'

  Step 'App packages (npm)'
  Push-Location $Target
  try {
    npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed (see above).' }
  } finally { Pop-Location }
  Ok 'Done'

  Step 'Scenarios generator packages (pip)'
  & $python -m pip install --quiet --disable-pip-version-check --upgrade pip
  & $python -m pip install --disable-pip-version-check -r (Join-Path $Target 'scenario-engine\requirements.txt')
  if ($LASTEXITCODE -ne 0) { Write-Host '   Some Python packages failed - everything except Scenarios still works. Run this again to retry.' -ForegroundColor Yellow }
  else { Ok 'Done' }
  [Environment]::SetEnvironmentVariable('SCENARIO_PYTHON', $python, 'User')
  $env:SCENARIO_PYTHON = $python

  Step 'Shortcuts'
  $shell = New-Object -ComObject WScript.Shell
  $places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))
  foreach ($dir in $places) {
    # Through cmd.exe (Windows only pins shortcuts to programs, not .bat
    # files), minimised: the app itself opens in the browser.
    # Same as setup\Create shortcuts.cmd.
    $link = $shell.CreateShortcut((Join-Path $dir 'Insight Plan.lnk'))
    $link.TargetPath = $env:ComSpec
    $link.Arguments = "/c `"`"$(Join-Path $Target 'Autorun.bat')`"`""
    $link.WorkingDirectory = $Target
    $link.Description = 'Start Insight Plan'
    $link.IconLocation = "$(Join-Path $Target 'setup\insight-plan.ico'),0"
    $link.WindowStyle = 7
    $link.Save()
  }
  Ok 'Desktop and Start menu: Insight Plan (right-click > Pin to taskbar)'

  Write-Host ''
  Write-Host 'Insight Plan is installed.' -ForegroundColor Green
  Write-Host 'Start it from the "Insight Plan" shortcut. New versions show as "Update available" at the top of the app.'
  $answer = Read-Host 'Start it now? (Y/n)'
  if ($answer -notmatch '^[nN]') { Start-Process -FilePath (Join-Path $Target 'Autorun.bat') -WorkingDirectory $Target }
} catch {
  Write-Host ''
  Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
