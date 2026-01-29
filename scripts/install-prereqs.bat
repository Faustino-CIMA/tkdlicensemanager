@echo off
setlocal enabledelayedexpansion

echo Installing prerequisites: Docker Desktop and Git
echo.

where choco >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo Chocolatey not found. Installing Chocolatey...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Set-ExecutionPolicy Bypass -Scope Process -Force; ^
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; ^
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"
  if %ERRORLEVEL% neq 0 (
    echo Failed to install Chocolatey. Please install it manually:
    echo https://chocolatey.org/install
    exit /b 1
  )
)

echo Installing Docker Desktop...
choco install docker-desktop -y
if %ERRORLEVEL% neq 0 (
  echo Failed to install Docker Desktop. Please install it manually:
  echo https://www.docker.com/products/docker-desktop/
)

echo Installing Git...
choco install git -y
if %ERRORLEVEL% neq 0 (
  echo Failed to install Git. Please install it manually:
  echo https://git-scm.com/download/win
)

echo.
echo Next steps:
echo 1. Launch Docker Desktop and finish setup.
echo 2. Restart your terminal.
echo 3. Verify installs:
echo    docker --version
echo    docker compose version
echo    git --version
echo.
pause
