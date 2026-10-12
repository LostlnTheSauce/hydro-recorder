@echo off
setlocal
title Build Grant G Field Temperature App
echo Building MadgeTechFieldBridge.exe from Bridge.cs...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-Bridge.ps1"
pause
