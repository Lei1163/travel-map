@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   赴迹 · 一键发布（构建 + 提交 + 推送）
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [x] 没有找到 git，请先安装 Git for Windows
  pause
  exit /b 1
)

echo [1/4] 重新生成 dist\ ...
python tools\build-dist.py
if errorlevel 1 (
  echo [x] 构建失败：请确认已安装 Python 3
  pause
  exit /b 1
)

echo.
echo [2/4] 暂存改动 ...
git add -A

echo.
echo [3/4] 提交 ...
set /p MSG=提交说明（直接回车用默认）:
if "%MSG%"=="" set MSG=update site
git commit -m "%MSG%"
if errorlevel 1 (
  echo [!] 没有新的改动，跳过提交
)

echo.
echo [4/4] 推送到 GitHub ...
git push

echo.
echo 完成。Cloudflare Pages 会在 1-2 分钟内自动重新部署。
echo 打开 Cloudflare 控制台 → Workers & Pages → 你的项目 → Deployments 查看进度。
pause