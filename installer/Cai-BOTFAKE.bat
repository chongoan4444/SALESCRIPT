@echo off
setlocal EnableExtensions
title BOTFAKE LITE - Cai dat

REM ===== Tu xin quyen Admin neu chua co =====
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Dang xin quyen Admin... Bam "Yes" khi Windows hoi.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

set "EXTID=jjdjmbjejaajhkocjniccgpmipgajmhg"
set "UPDURL=https://chongoan4444.github.io/SALESCRIPT/update.xml"

echo Dang cai BOTFAKE LITE cho Chrome...
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "%EXTID%;%UPDURL%" /f >nul 2>&1
if %errorlevel% neq 0 (
  echo [LOI] Khong ghi duoc cau hinh. Hay chay lai file nay bang quyen Admin.
  pause
  exit /b 1
)
reg add "HKLM\SOFTWARE\Wow6432Node\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "%EXTID%;%UPDURL%" /f >nul 2>&1

REM ===== Tim duong dan Chrome that tren may =====
set "CHROME="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if not defined CHROME if exist %%P set "CHROME=%%~P"
)
if not defined CHROME for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do if "%%A"=="REG_SZ" set "CHROME=%%B"
if not defined CHROME for /f "tokens=2*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do if "%%A"=="REG_SZ" set "CHROME=%%B"

if defined CHROME (
  echo Da cai xong. Dang mo Chrome...
  start "" "%CHROME%" "https://pancake.vn"
) else (
  echo [Luu y] Khong tim thay Chrome tren may nay nen khong tu mo duoc.
  echo Cau hinh cai dat DA GHI XONG - chi can tu mo Chrome len,
  echo cho khoang 1 phut la extension BOTFAKE tu xuat hien.
  echo Neu may chua cai Chrome thi phai cai Chrome truoc.
)

echo.
echo ============================================================
echo  CAI DAT HOAN TAT
echo  1. Cho khoang 1 phut: bieu tuong BOTFAKE se tu xuat hien
echo     o goc phai tren cua Chrome. Mo pancake.vn la dung duoc.
echo  2. Neu Chrome dang mo san tu truoc, hay tat het mo lai.
echo  3. Chrome co the bao "duoc quan ly boi to chuc cua ban" -
echo     do la co che cai dat nay, khong phai loi.
echo  4. Extension nay khong tu tat/go bang tay duoc. Muon go,
echo     chay file Go-BOTFAKE.bat.
echo ============================================================
echo.
pause
