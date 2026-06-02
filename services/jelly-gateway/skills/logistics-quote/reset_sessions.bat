@echo off
setlocal
chcp 65001 >nul 2>nul

> quote_sessions.json echo {
>> quote_sessions.json echo   "active_task_id": null,
>> quote_sessions.json echo   "tasks": {}
>> quote_sessions.json echo }
call :Say "5bey5riF56m65omA5pyJ5oql5Lu35Lu75Yqh6K6w5b2V44CC"
exit /b 0

:Say
powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%~1')))"
exit /b 0
