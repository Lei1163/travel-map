@echo off
setlocal
cd /d "%~dp0"

set "PYTHON="
where py >nul 2>nul && set "PYTHON=py"
if not defined PYTHON (
  where python >nul 2>nul && set "PYTHON=python"
)

if not defined PYTHON (
  echo Python not found. Opening index.html directly...
  start "" "index.html"
  exit /b 0
)

echo Starting Roam at http://127.0.0.1:8080 ...
start "Roam Atlas Server" /min cmd /c "%PYTHON% -m http.server 8080"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8080/"
endlocal
