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

REM ===== Tim duong dan Chrome that tren may =====
set "CHROME="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if not defined CHROME if exist %%P set "CHROME=%%~P"
)
if not defined CHROME for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do if "%%A"=="REG_SZ" set "CHROME=%%B"
if not defined CHROME for /f "tokens=2*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do if "%%A"=="REG_SZ" set "CHROME=%%B"

if defined CHROME (
  echo Da go xong. Dang mo lai Chrome...
  start "" "%CHROME%"
) else (
  echo Da go xong cau hinh. Mo lai Chrome la extension se tu bien mat.
)

echo.
echo ============================================================
echo  DA GO XONG
echo  Hay tat het Chrome roi mo lai, extension se tu bien mat.
echo ============================================================
echo.
pause
