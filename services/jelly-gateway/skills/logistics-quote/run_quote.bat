@echo off
setlocal
chcp 65001 >nul 2>nul

if not exist ".venv\Scripts\python.exe" (
  call :Say "6K+35YWI6L+Q6KGMIHNldHVwX2Vudi5iYXQg5Yid5aeL5YyW546v5aKD44CC"
  exit /b 1
)

".venv\Scripts\python.exe" quote_query.py %*
exit /b %ERRORLEVEL%

:Say
powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%~1')))"
exit /b 0
