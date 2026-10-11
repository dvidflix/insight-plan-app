@echo off
title Insight Plan - browser edition
REM Starts the browser edition (no server side) and opens it in Edge once it answers.
REM "Start web edition.cmd build" builds the site and serves that instead, so Install and offline work.
REM Closing this window stops it.
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run setup\Install Insight Plan.cmd first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing packages...
  call npm install
)
set "PORT=5174"
if /i "%~1"=="build" (
  echo Building the site...
  call npm run build:web
  if errorlevel 1 (
    pause
    exit /b 1
  )
  start "" cmd /c "timeout /t 4 /nobreak >nul & start msedge http://localhost:%PORT%"
  call npx vite preview --outDir dist-web --mode web --port %PORT% --strictPort
) else (
  start "" cmd /c "timeout /t 6 /nobreak >nul & start msedge http://localhost:%PORT%"
  call npx vite --mode web --port %PORT% --strictPort
)
pause
