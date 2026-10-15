@echo off
title Insight Plan
cd /d "%~dp0"
REM The Python that ships in this folder runs the Scenarios generator and the IFC tools; nothing needs installing.
if exist "%~dp0runtime\python\python.exe" set "SCENARIO_PYTHON=%~dp0runtime\python\python.exe"
if not defined SCENARIO_PYTHON for /f "tokens=2,*" %%a in ('reg query HKCU\Environment /v SCENARIO_PYTHON 2^>nul ^| find "SCENARIO_PYTHON"') do set "SCENARIO_PYTHON=%%b"
set PORT=4173

REM An update the app downloaded last time (updates\staged) is installed before starting.
call :apply

REM The app opens in its own window (Chrome or Edge) once the server answers. INSIGHT_NO_BROWSER=1 skips that.
if not defined INSIGHT_NO_BROWSER start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 40;$i++){try{(Invoke-WebRequest http://127.0.0.1:%PORT% -UseBasicParsing -TimeoutSec 1)|Out-Null;break}catch{Start-Sleep -Milliseconds 500}}; $b=@('chrome','msedge')|ForEach-Object{(Get-Command $_ -ErrorAction SilentlyContinue).Source}|Select-Object -First 1; if($b){Start-Process $b '--app=http://127.0.0.1:%PORT%'}else{Start-Process http://127.0.0.1:%PORT%}"

:serve
"%~dp0runtime\node.exe" "%~dp0server-dist\server.mjs"
REM Exit code 75: "Update now" was pressed. Install the update and start again; the open window reconnects by itself.
set "CODE=%errorlevel%"
if "%CODE%"=="75" call :apply
if "%CODE%"=="75" goto serve
pause
exit /b %CODE%

:apply
if not exist "%~dp0updates\staged\.ready" exit /b 0
echo Installing the update...
if exist "%~dp0updates\backup" rmdir /s /q "%~dp0updates\backup"
set "FAILED="
call :swap dist
call :swap server-dist
call :swap scenario-engine
call :swap docs
copy /y "%~dp0updates\staged\version.json" "%~dp0version.json" >nul
if exist "%~dp0updates\staged\THIRD-PARTY-NOTICES.txt" copy /y "%~dp0updates\staged\THIRD-PARTY-NOTICES.txt" "%~dp0THIRD-PARTY-NOTICES.txt" >nul
if exist "%~dp0updates\staged\THIRD-PARTY-LICENSES.json" copy /y "%~dp0updates\staged\THIRD-PARTY-LICENSES.json" "%~dp0THIRD-PARTY-LICENSES.json" >nul
if defined FAILED (
  echo The update could not be installed completely. The previous version is in the updates\backup folder.
  exit /b 1
)
rmdir /s /q "%~dp0updates\staged"
exit /b 0

:swap
if not exist "%~dp0updates\staged\%1" exit /b 0
robocopy "%~dp0%1" "%~dp0updates\backup\%1" /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "%~dp0updates\staged\%1" "%~dp0%1" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 set "FAILED=1"
exit /b 0
