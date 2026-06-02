@echo off
setlocal
chcp 65001 >nul 2>nul

set "PYTHON_CMD="
set "PYTHON_PATH="
set "BUNDLED_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

call :TryPython "py -3"
call :TryPython "python"
if exist "%BUNDLED_PY%" call :TryPython "%BUNDLED_PY%"

if not defined PYTHON_CMD (
  call :Say "5b2T5YmNIFB5dGhvbiDnjq/looPnvLrlsJEgcGlw77yM6K+35a6J6KOF5a6Y5pa5IFB5dGhvbiAzLjEwK++8jOW5tuWLvumAiSBBZGQgUHl0aG9uIHRvIFBBVEjjgII="
  exit /b 1
)

call :Say "5qOA5rWL5YiwIFB5dGhvbu+8mg=="
echo %PYTHON_PATH%

if not exist ".venv" (
  call :Say "5q2j5Zyo5Yib5bu65pys5Zyw6Jma5ouf546v5aKDIC52ZW52IC4uLg=="
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 (
    call :Say "5Yib5bu66Jma5ouf546v5aKD5aSx6LSl77yM6K+356Gu6K6kIFB5dGhvbiDniYjmnKzkuLogMy4xMCvjgII="
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  call :Say "6Jma5ouf546v5aKD5LiN5a6M5pW077yM6K+35Yig6ZmkIC52ZW52IOWQjumHjeaWsOi/kOihjCBzZXR1cF9lbnYuYmF044CC"
  exit /b 1
)

".venv\Scripts\python.exe" -m pip --version >nul 2>nul
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m ensurepip --upgrade >nul 2>nul
)

".venv\Scripts\python.exe" -m pip --version >nul 2>nul
if errorlevel 1 (
  call :Say "5b2T5YmNIFB5dGhvbiDnjq/looPnvLrlsJEgcGlw77yM6K+35a6J6KOF5a6Y5pa5IFB5dGhvbiAzLjEwK++8jOW5tuWLvumAiSBBZGQgUHl0aG9uIHRvIFBBVEjjgII="
  exit /b 1
)

call :Say "5q2j5Zyo5a6J6KOF5L6d6LWWIC4uLg=="
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  call :Say "5L6d6LWW5a6J6KOF5aSx6LSl77yM6K+35qOA5p+l572R57uc5oiWIHJlcXVpcmVtZW50cy50eHTjgII="
  exit /b 1
)

call :Say "546v5aKD5Yid5aeL5YyW5a6M5oiQ44CC5ZCO57ut6K+35L2/55SoIHJ1bl9xdW90ZS5iYXQg6L+Q6KGM5oql5Lu35Yqp5omL44CC"
exit /b 0

:TryPython
if defined PYTHON_CMD exit /b 0
set "CAND=%~1"
if "%CAND%"=="" exit /b 0

%CAND% -c "import sys; print(sys.executable)" > "%TEMP%\quote_python_path.txt" 2>nul
if errorlevel 1 exit /b 0

set "CAND_PATH="
for /f "usebackq delims=" %%P in ("%TEMP%\quote_python_path.txt") do set "CAND_PATH=%%P"

%CAND% -m pip --version >nul 2>nul
if errorlevel 1 (
  %CAND% -m ensurepip --upgrade >nul 2>nul
)

%CAND% -m pip --version >nul 2>nul
if errorlevel 1 (
  call :Say "6Lez6L+HIFB5dGhvbu+8mg=="
  echo %CAND_PATH%
  call :Say "77yI57y65bCRIHBpcO+8iQ=="
  exit /b 0
)

set "PYTHON_CMD=%CAND%"
set "PYTHON_PATH=%CAND_PATH%"
exit /b 0

:Say
powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%~1')))"
exit /b 0
