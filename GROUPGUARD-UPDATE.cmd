@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo GroupGuard 一键更新 / 生产代码部署
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\groupguard-update.ps1"
set "rc=%ERRORLEVEL%"
echo.
if not "%rc%"=="0" (
  echo [FAILED] 更新/部署未完成，退出码 %rc%。
) else (
  echo [OK] 更新/部署完成。
)
pause
exit /b %rc%
