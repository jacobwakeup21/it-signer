# PowerShell startup script for IT Handover Signer
Set-Location -Path $PSScriptRoot

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "    IT Handover PDF Signer - Mobile & Desktop" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

# Ensure dependencies
Write-Host "Verifying Python dependencies..." -ForegroundColor Gray
python -m pip install -r requirements.txt --quiet

# Open local dashboard in browser
Start-Process "http://localhost:5000"

# Start Flask
python app.py
