<# : batch part (PowerShell reads this as a comment)
@echo off
REM Checks what Insight Plan needs on this laptop - above all the Python the
REM Scenarios generator (preparing / enriching IFCs) runs on - says what is
REM wrong and offers to fix it. Double-click it. Safe to run any time.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:IP_ROOT = '%~dp0..'; & ([scriptblock]::Create((Get-Content -LiteralPath '%~f0' -Raw)))"
echo.
pause
exit /b
#>

$root = (Resolve-Path $env:IP_ROOT).Path
$problems = New-Object System.Collections.Generic.List[string]
function Ok($t) { Write-Host "  OK    $t" -ForegroundColor Green }
function Bad($t, $fix) { Write-Host "  FAIL  $t" -ForegroundColor Red; if ($fix) { Write-Host "        -> $fix" -ForegroundColor Yellow }; $problems.Add($t) }
function Warn($t) { Write-Host "  NOTE  $t" -ForegroundColor Yellow }
function Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }

Write-Host "Insight Plan check - $root"

Step 'Node.js (the app)'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Bad 'Node.js is not installed.' 'Run setup\Install Insight Plan.cmd.' }
else {
  $v = (& node --version).Trim()
  $n = [version]($v.TrimStart('v'))
  if ($n -ge [version]'22.5.0') { Ok "Node.js $v" } else { Bad "Node.js $v is too old (22.5 or later is needed for the project database)." 'Run setup\Install Insight Plan.cmd.' }
}

Step 'Python for the Scenarios generator'
$fromProcess = $env:SCENARIO_PYTHON
$fromUser = [Environment]::GetEnvironmentVariable('SCENARIO_PYTHON', 'User')
$python = if ($fromUser) { $fromUser } elseif ($fromProcess) { $fromProcess } else { $null }
if (-not $fromUser) {
  Warn 'SCENARIO_PYTHON is not set for this user: the app then runs whatever "python" is first on the PATH.'
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -like '*\WindowsApps\*') { Bad 'The "python" on the PATH is the Microsoft Store shortcut, not a real Python.' 'Run setup\Install Insight Plan.cmd (installs Python 3.12 and sets SCENARIO_PYTHON).' }
  elseif ($cmd) { $python = $cmd.Source }
}
if (-not $python) { Bad 'No Python found for the generator.' 'Run setup\Install Insight Plan.cmd.' }
elseif (-not (Test-Path $python)) { Bad "SCENARIO_PYTHON points to a file that does not exist: $python" 'Run setup\Install Insight Plan.cmd again (it finds Python and sets SCENARIO_PYTHON).' ; $python = $null }
else {
  Ok "Python: $python"
  if ($fromUser -and $fromProcess -ne $fromUser) { Warn 'SCENARIO_PYTHON was set after this window opened: close the app window and start Insight Plan again so it picks it up.' }
  $ver = (& $python -c "import sys; print('%d.%d.%d' % sys.version_info[:3])" 2>$null)
  if ($ver) { if ([version]$ver -ge [version]'3.10') { Ok "Python $ver" } else { Bad "Python $ver is too old (3.10 or later; 3.12 recommended)." 'Run setup\Install Insight Plan.cmd.' } }
}

$missing = @()
if ($python) {
  Step 'Python packages (scenario-engine\requirements.txt)'
  $checks = [ordered]@{
    'ifcopenshell' = "import ifcopenshell; print(ifcopenshell.version)"
    'ifcopenshell geometry' = "import ifcopenshell, ifcopenshell.geom; s = ifcopenshell.geom.settings(); t = ifcopenshell.geom.tree(); print('ok')"
    'ifcclash (clash detection)' = "from ifcclash.ifcclash import Clasher, ClashSettings; print('ok')"
    'pandas' = "import pandas; print(pandas.__version__)"
    'openpyxl' = "import openpyxl; print(openpyxl.__version__)"
  }
  foreach ($name in $checks.Keys) {
    $out = & $python -c $checks[$name] 2>&1
    if ($LASTEXITCODE -eq 0) { Ok "$name $(($out | Select-Object -Last 1))" }
    else {
      $why = ($out | Where-Object { $_ -match 'Error' } | Select-Object -Last 1)
      Bad "$name - $why" $null
      $missing += $name
    }
  }
  if ($missing -contains 'ifcclash (clash detection)' -and $missing.Count -eq 1) { Warn 'Without ifcclash the generator still runs, but finds no pour-to-pour clashes: the automatic order and links come out wrong.' }

  Step 'The generator itself'
  Push-Location (Join-Path $root 'scenario-engine')
  $out = & $python -c "import config, main; from core import xml_builder, clash_detection, ifc_class_fixer; print('ok')" 2>&1
  Pop-Location
  if ($LASTEXITCODE -eq 0) { Ok 'scenario-engine loads (main.py, class fixer, clash detection, XML builder)' }
  else { Bad "scenario-engine does not load: $(($out | Select-Object -Last 3) -join ' | ')" 'Usually a missing package (see above), or an incomplete copy of the app: run setup\Install Insight Plan.cmd again.' }
}

Step 'The app'
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:5173/api/scenarios/default-root' | Out-Null
  Ok 'Insight Plan is running (http://localhost:5173)'
} catch { Warn 'Insight Plan is not running now (start it from its shortcut to use Scenarios; not needed for this check).' }
$docs = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Insight Plan'
try {
  New-Item -ItemType Directory -Force -Path $docs | Out-Null
  $probe = Join-Path $docs '.write-test'
  Set-Content -LiteralPath $probe -Value 'x' -ErrorAction Stop; Remove-Item -LiteralPath $probe
  Ok "Can write to $docs (default project folder)"
} catch { Bad "Cannot write to $docs" 'Check the folder permissions / OneDrive sync, or pick a project folder elsewhere in the Scenario panel.' }

Write-Host ''
if ($problems.Count -eq 0) {
  Write-Host 'Everything the generator needs is in place.' -ForegroundColor Green
  Write-Host 'If patching still fails: load the .ifc again from Inputs in this session (a model restored from an earlier session or a .frag cannot be written back), and open a project folder to save the _FIXED.ifc there (without one it is downloaded).'
  return
}
Write-Host "$($problems.Count) problem(s) found." -ForegroundColor Red
if ($python -and $missing.Count -gt 0) {
  $answer = Read-Host 'Install the missing Python packages now? (Y/n)'
  if ($answer -notmatch '^[nN]') {
    & $python -m pip install --disable-pip-version-check --upgrade pip
    & $python -m pip install --disable-pip-version-check -r (Join-Path $root 'scenario-engine\requirements.txt')
    if ($LASTEXITCODE -eq 0) { Write-Host 'Installed. Run this check again, then restart Insight Plan.' -ForegroundColor Green }
    else { Write-Host 'pip failed - see the messages above (a proxy or firewall blocking pypi.org is common on managed laptops).' -ForegroundColor Red }
  }
}
if ($python -and -not $fromUser) {
  $answer = Read-Host "Set SCENARIO_PYTHON to $python for this user? (Y/n)"
  if ($answer -notmatch '^[nN]') { [Environment]::SetEnvironmentVariable('SCENARIO_PYTHON', $python, 'User'); Write-Host 'Set. Restart Insight Plan so it picks it up.' -ForegroundColor Green }
}
