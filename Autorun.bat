@echo off
REM Starts Insight Plan in this one window: stops a running copy, installs
REM packages, then runs the dev server here and opens the app once it
REM answers. Closing this window stops the app. "Autorun.bat update" (run by
REM the app's Update button) also gets the latest version from GitHub first,
REM and leaves the open page to reload itself instead of opening a new one.
cd /d "%~dp0"
set "MODE=%~1"
set "PORT=5173"
REM The generator's Python, as the installer saved it for this user - also
REM when this window was opened from a session that started before that.
if not defined SCENARIO_PYTHON for /f "tokens=2,*" %%a in ('reg query HKCU\Environment /v SCENARIO_PYTHON 2^>nul ^| find "SCENARIO_PYTHON"') do set "SCENARIO_PYTHON=%%b"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run setup\Install Insight Plan.cmd first.
  pause
  exit /b 1
)

if /i "%MODE%"=="update" (
  echo Updating Insight Plan...
  REM Let the app's request finish before its server is stopped.
  timeout /t 2 /nobreak >nul
)

echo Stopping a running copy (if any)...
REM Its window (and the server in it), a "Dev Server" window left by older
REM versions of this script, and whatever else still holds the port.
taskkill /FI "WINDOWTITLE eq Insight Plan server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Dev Server*" /T >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do taskkill /PID %%p /T /F >nul 2>&1
REM Only now take the title a later run looks for.
title Insight Plan server

if /i not "%MODE%"=="update" (
  REM Close the Chrome / Edge window whose title contains Insight Plan (the
  REM whole window, not a single tab among others).
  powershell -NoProfile -Command ^
    "$p = Get-Process chrome, msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*Insight Plan*' };" ^
    "if ($p) { $p | ForEach-Object { $_.CloseMainWindow() | Out-Null } }"
)

if /i "%MODE%"=="update" (
  echo Getting the latest version from GitHub...
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo The update could not be downloaded - see the message above.
    echo Starting the version you have.
    echo.
  )
  if defined SCENARIO_PYTHON (
    echo Updating the Scenarios generator's Python packages...
    "%SCENARIO_PYTHON%" -m pip install --quiet --disable-pip-version-check -r scenario-engine\requirements.txt
  )
)

echo Installing dependencies...
call npm install --no-fund --no-audit --loglevel=error
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

if /i not "%MODE%"=="update" (
  REM Opens the app as soon as the server answers, from the background: as
  REM a Chrome (else Edge) app window - no bookmarks bar, no address bar, its
  REM own taskbar button - or in the default browser when neither is found.
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
    "$url = 'http://localhost:%PORT%/';" ^
    "$exe = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'), (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1;" ^
    "for ($i = 0; $i -lt 90; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $url | Out-Null; if ($exe) { Start-Process $exe ('--app=' + $url) } else { Start-Process $url }; break } catch { Start-Sleep -Milliseconds 700 } }"
)

cls
echo Insight Plan is running at http://localhost:%PORT%/
echo Close this window to stop it.
echo.
REM --strictPort: never drift to another port the browser doesn't know about.
call npm run dev -- --strictPort --port %PORT%
if errorlevel 1 (
  echo.
  echo The server stopped with an error - see above. Port %PORT% may be used by another program.
  pause
)
exit
