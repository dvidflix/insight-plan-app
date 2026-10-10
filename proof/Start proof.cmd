@echo off
title Insight Plan - browser database proof
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  pause
  exit /b 1
)
echo Starting the test server. Edge will open in a few seconds.
echo Close this window when you are done.
start "" cmd /c "timeout /t 5 /nobreak >nul & start msedge http://localhost:5190/folder.html"
call npx vite --config proof/vite.config.ts
pause
