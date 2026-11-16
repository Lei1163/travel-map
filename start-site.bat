@echo off
setlocal
cd /d "%~dp0"

set "PYTHON="
where py >nul 2>nul && set "PYTHON=py"
if not defined PYTHON (
  where python >nul 2>nul && set "PYTHON=python"
)
if not defined PYTHON (
  echo Python not found. Install Python or upload the dist folder to a static host.
  pause
  exit /b 1
)

echo Starting the site at http://127.0.0.1:8081 ...
start "Roam Atlas Site" /min cmd /c "%PYTHON% -m http.server 8081 --directory dist"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8081/"
endlocal
