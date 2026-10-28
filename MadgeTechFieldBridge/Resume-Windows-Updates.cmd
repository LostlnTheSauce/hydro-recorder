@echo off
setlocal
title Resume Windows updates
echo Resumes Windows updates on this field laptop (undoes the pause that field mode sets).
echo Do this between jobs, then install updates and restart while no test is running.
echo Click Yes on the Windows prompt.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Field-Windows-Update-Hold.ps1" -Resume
pause
