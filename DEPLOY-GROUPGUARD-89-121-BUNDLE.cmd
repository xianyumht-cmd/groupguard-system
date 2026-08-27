@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0groupguard-deploy-bundle.ps1"
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo GroupGuard immutable bundle deployment to 192.168.3.89 and 192.168.3.121 completed successfully.
) else (
  echo GroupGuard immutable bundle deployment failed. Review the error above.
)
pause
exit /b %CODE%
