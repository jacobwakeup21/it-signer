@echo off
title IT Handover Signer + Cloudflare Public Tunnel
cd /d "%~dp0"

echo =========================================================
echo   IT Handover Signer - Public Cloud / Tunnel Launcher
echo =========================================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found in PATH.
    pause
    exit /b 1
)

:: Check if cloudflared.exe exists, download if missing
if not exist "cloudflared.exe" (
    echo [INFO] Downloading Cloudflare Tunnel client (cloudflared.exe)...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if %errorlevel% neq 0 (
        echo [WARNING] Could not automatically download cloudflared.exe.
        echo You can manually download it from https://github.com/cloudflare/cloudflared/releases
    )
)

:: Start Flask server in background
echo Starting local Flask server on port 5000...
start "IT Signer Server" cmd /c "python app.py"

:: Give Flask a second to spin up
timeout /t 2 /nobreak >nul

:: Open local dashboard in browser
start "" "http://localhost:5000"

:: Start Cloudflare Quick Tunnel
if exist "cloudflared.exe" (
    echo.
    echo =========================================================
    echo  Creating public HTTPS tunnel to bridge corporate subnet
    echo =========================================================
    echo  Look for the https://*.trycloudflare.com link below!
    echo  Copy and paste that link into the Desktop Dashboard 
    echo  to update the QR code for phones on cellular data.
    echo =========================================================
    echo.
    cloudflared.exe tunnel --url http://localhost:5000
) else (
    echo Please install cloudflared or deploy to a cloud host (Render/Railway).
    pause
)
