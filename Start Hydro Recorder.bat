@echo off
title Hydro Recorder
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First run: setting up...
  python -m venv .venv || goto :nopython
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
)
".venv\Scripts\python.exe" -m recorder
pause
exit /b

:nopython
echo Python is not installed on this computer. Install it from python.org, then run this again.
pause
