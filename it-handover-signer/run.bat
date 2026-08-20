@echo off
title IT Handover PDF Signer
cd /d "%~dp0"

echo ===================================================
echo     IT Handover PDF Signer - Mobile & Desktop
echo ===================================================
echo.

:: Check python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in PATH.
    echo Please install Python 3.9+ and ensure it is added to PATH.
    pause
    exit /b 1
)

:: Install dependencies if missing
echo Checking dependencies...
python -m pip install -r requirements.txt --quiet

:: Launch server and open browser
echo Starting Flask web server...
start "" "http://localhost:5000"
python app.py

pause
