@echo off
setlocal

set "EXT_DIR=%~dp0"
for %%I in ("%EXT_DIR%.") do set "EXT_DIR=%%~fI"
for %%I in ("%EXT_DIR%\..") do set "DEV_DIR=%%~fI"

set "PROFILE_ROOT=%DEV_DIR%\codex-oauth-automation-extension-hero-profile"
set "PROFILE_DIR=%PROFILE_ROOT%\edge-user-data"
set "EDGE_BIN=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if not exist "%EDGE_BIN%" (
  set "EDGE_BIN=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if not exist "%EDGE_BIN%" (
  echo Microsoft Edge not found. Please install Edge or update EDGE_BIN in this script.
  pause
  exit /b 1
)

if not exist "%PROFILE_DIR%" (
  mkdir "%PROFILE_DIR%"
)

start "" "%EDGE_BIN%" ^
  --remote-debugging-port=9222 ^
  --lang=en-US ^
  --user-data-dir="%PROFILE_DIR%" ^
  --disable-extensions-except="%EXT_DIR%" ^
  --load-extension="%EXT_DIR%" ^
  --no-first-run ^
  edge://extensions/
