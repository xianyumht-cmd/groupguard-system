@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\groupguard-update-89-121.ps1" -RepoPath "%~dp0"
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo GroupGuard deployment to 192.168.3.89 and 192.168.3.121 completed successfully.
) else (
  echo GroupGuard dual-host deployment failed. Review the error above; remote rollback is automatic after a failed switch.
)
pause
exit /b %CODE%
