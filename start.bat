@echo off
chcp 65001 >nul
title سیستم مدیریت تانک تیل و پمپ استیشن
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ خطا ]  Node.js نصب نیست.
  echo   نسخه 22 یا بالاتر را از nodejs.org نصب کنید.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo.
  echo   [ خطا ]  نسخه Node.js شما قدیمی است.
  echo   این سیستم به Node.js نسخه 22 یا بالاتر ضرورت دارد.
  echo.
  pause
  exit /b 1
)

if not defined PORT set PORT=8080
echo.
echo   در حال راه اندازی...
start "" http://localhost:%PORT%
node server\index.js
pause
