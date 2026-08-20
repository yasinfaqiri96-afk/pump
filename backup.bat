@echo off
chcp 65001 >nul
title بکاپ دیتابیس
cd /d "%~dp0"

set STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%
set STAMP=%STAMP: =0%
if not exist backups mkdir backups

node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/pump.db');d.exec(\"VACUUM INTO 'backups/pump_%STAMP%.db'\");console.log('  بکاپ ساخته شد: backups/pump_%STAMP%.db')"

if errorlevel 1 (
  echo   [ خطا ] بکاپ ناکام شد.
) else (
  echo.
  echo   بکاپ را روی USB یا کمپیوتر دیگر کاپی کنید.
)
echo.
pause
