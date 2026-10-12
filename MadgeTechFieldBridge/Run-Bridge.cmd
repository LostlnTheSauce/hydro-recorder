@echo off
setlocal
title Grant G Field Temperature App
echo Grant G - Field temperatures
echo Keep MadgeTech 4 open in Real Time mode.
echo Leave this window open. Start and stop recording on the host website.
echo.
if not exist "%~dp0MadgeTechFieldBridge.exe" (
  echo The field app is missing MadgeTechFieldBridge.exe.
  echo Extract the whole field app folder before opening Run-Bridge.cmd.
  pause
  exit /b 1
)
if "%~1"=="" (
  "%~dp0MadgeTechFieldBridge.exe"
  pause
  exit /b
)
"%~dp0MadgeTechFieldBridge.exe" "%~1"
pause
