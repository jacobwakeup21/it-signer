@echo off
title IT Handover Signer - Local PC Sync
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "sync_signed_to_pc.ps1"
pause
