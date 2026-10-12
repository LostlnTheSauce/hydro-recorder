@echo off
setlocal
title Grant G Field Temperatures - Battery Friendly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Field-Power-Mode.ps1"
pause
