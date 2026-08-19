@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo GroupGuard 一键生产代码回滚
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\groupguard-rollback.ps1"
set "rc=%ERRORLEVEL%"
echo.
if not "%rc%"=="0" (
  echo [FAILED] 回滚未完成，退出码 %rc%。
) else (
  echo [OK] 回滚完成。
)
pause
exit /b %rc%
