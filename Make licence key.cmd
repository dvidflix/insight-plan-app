@echo off
title Insight Plan - make a licence key
REM Asks for the customer, the last day and the seats, prints the key and copies it to the clipboard.
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run setup\Install Insight Plan.cmd first.
  pause
  exit /b 1
)
if not exist tools\licence-private.jwk (
  echo No signing key on this computer ^(tools\licence-private.jwk^), so keys cannot be made here.
  pause
  exit /b 1
)
set "CUSTOMER="
set "EXPIRES="
set "SEATS=3"
set "PROJECT="
set "MODULES=both"
set /p "CUSTOMER=Customer name: "
set /p "EXPIRES=Last day of use (YYYY-MM-DD): "
set /p "SEATS=Planner seats [3]: "
set /p "PROJECT=Project name (optional): "
set /p "MODULES=Licence: programmes, models or both [both]: "
if not defined MODULES set "MODULES=both"
if not defined SEATS set "SEATS=3"
if defined PROJECT (
  node tools\licence.mjs issue "%CUSTOMER%" %EXPIRES% --seats %SEATS% --modules %MODULES% --project "%PROJECT%" > "%TEMP%\insight-plan-key.txt"
) else (
  node tools\licence.mjs issue "%CUSTOMER%" %EXPIRES% --seats %SEATS% --modules %MODULES% > "%TEMP%\insight-plan-key.txt"
)
if errorlevel 1 (
  echo.
  echo The key could not be made. Check the customer name and the date ^(YYYY-MM-DD^).
  del "%TEMP%\insight-plan-key.txt" >nul 2>&1
  pause
  exit /b 1
)
echo.
type "%TEMP%\insight-plan-key.txt"
clip < "%TEMP%\insight-plan-key.txt"
del "%TEMP%\insight-plan-key.txt" >nul 2>&1
echo.
echo Copied to the clipboard. Paste it into the licence screen.
pause
