@echo off
setlocal EnableExtensions
title BOTFAKE LITE - Go cai dat

REM ===== Tu xin quyen Admin neu chua co =====
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Dang xin quyen Admin... Bam "Yes" khi Windows hoi.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo Dang go BOTFAKE LITE khoi Chrome...
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Wow6432Node\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /f >nul 2>&1

echo Da go cau hinh. Dang mo lai Chrome...
start "" "chrome"

echo.
echo ============================================================
echo  DA GO XONG
echo  Hay tat het Chrome roi mo lai, extension se tu bien mat.
echo ============================================================
echo.
pause
