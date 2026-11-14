@echo off
rem Global SAR: install (first run only), build and start the app. Double-click this file on Windows.
rem Uses npm.cmd so it also works where PowerShell blocks npm scripts.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(version 20.19 or newer^) and run this again.
  pause
  exit /b 1
)
if not exist "web/node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm.cmd run setup
  if errorlevel 1 (
    echo Setup failed.
    pause
    exit /b 1
  )
)
echo Starting Global SAR. The address is printed below ^(normally http://localhost:4173^). Close this window to stop.
call npm.cmd start
pause
