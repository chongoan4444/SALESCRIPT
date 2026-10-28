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

echo Da cai xong. Dang mo Chrome...
start "" "chrome" "https://pancake.vn"

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
