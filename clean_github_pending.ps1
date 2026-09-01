# ==============================================================================
#  Clean GitHub Pending Folder Script
# ==============================================================================
param (
    [string] = "",
    [string] = "",
    [string] = "main"
)

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   IT Handover Signer - GitHub Pending Cleanup    " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Load config.json if parameters not provided
 = Join-Path  "config.json"
if (Test-Path ) {
    try {
         = Get-Content  -Raw | ConvertFrom-Json
        if (-not  -and .github_repo) {  = .github_repo }
        if (-not  -and .github_token) {  = .github_token }
        if (.github_branch) {  = .github_branch }
    } catch {}
}

# 2. Prompt if still missing
if (-not ) {
     = Read-Host "Enter GitHub Repository (owner/repo, e.g. your-username/it-handover-signer)"
}
# Normalize repo
 = .Trim()
if ( -match "github\.com[/:]([^/]+/[^/.]+)") {
     = [1]
}

if (-not ) {
     = Read-Host "Enter GitHub Personal Access Token (PAT)"
}

if (-not  -or -not ) {
    Write-Host "Error: Both Repository and Token are required." -ForegroundColor Red
    exit 1
}

 = @{
    "Authorization" = "Bearer "
    "Accept"        = "application/vnd.github+json"
    "User-Agent"    = "IT-Handover-Signer-Cleanup/1.0"
}

Write-Host "Connecting to GitHub ( - )..." -ForegroundColor Yellow
 = "https://api.github.com/repos//contents/pending?ref="

try {
     = Invoke-RestMethod -Uri  -Headers  -Method Get -TimeoutSec 15
} catch {
    if (.Exception.Response.StatusCode.value__ -eq 404) {
        Write-Host "Pending folder on GitHub is already empty or does not exist." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "Failed to connect to GitHub: " -ForegroundColor Red
        exit 1
    }
}

 = @( | Where-Object { .type -eq "file" -and .name -ne ".gitkeep" })

if (.Count -eq 0) {
    Write-Host "GitHub pending folder is already clean (0 files found)!" -ForegroundColor Green
    exit 0
}

Write-Host "Found 0 file(s) in GitHub pending folder:" -ForegroundColor Yellow
foreach ( in ) {
    Write-Host "  -  ( bytes)" -ForegroundColor Gray
}

 = Read-Host "
Do you want to permanently delete all 0 files from GitHub? (y/N)"
if ( -ne "y" -and  -ne "Y") {
    Write-Host "Operation cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
 = 0

foreach ( in ) {
     = "https://api.github.com/repos//contents/"
     = @{
        message = "Delete  via cleanup script"
        sha     = .sha
        branch  = 
    } | ConvertTo-Json

    try {
         = Invoke-RestMethod -Uri  -Headers  -Method Delete -Body  -ContentType "application/json"
        Write-Host "  [DELETED] " -ForegroundColor Green
        ++
    } catch {
        Write-Host "  [FAILED]  : " -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Cleanup completed:  of 0 file(s) deleted." -ForegroundColor Cyan
