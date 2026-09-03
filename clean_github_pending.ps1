# ==============================================================================
#  Clean GitHub Pending Folder Script
# ==============================================================================
param (
    [string]$Repo = '',
    [string]$Token = '',
    [string]$Branch = 'main'
)

Write-Host '===================================================' -ForegroundColor Cyan
Write-Host '   IT Handover Signer - GitHub Pending Cleanup    ' -ForegroundColor Cyan
Write-Host '===================================================' -ForegroundColor Cyan
Write-Host ''

function Quote-GitHubPath([string]$PathStr) {
    $clean = $PathStr.Trim().TrimStart('/')
    $parts = $clean.Split('/')
    $encoded = foreach ($p in $parts) { [System.Uri]::EscapeDataString($p) }
    return ($encoded -join '/')
}

# 1. Load config.json if parameters not provided
$configPath = Join-Path $PSScriptRoot 'config.json'
if (Test-Path $configPath) {
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if (-not $Repo -and $config.github_repo) { $Repo = $config.github_repo }
        if (-not $Token -and $config.github_token) { $Token = $config.github_token }
        if ($config.github_branch) { $Branch = $config.github_branch }
    } catch {}
}

# 2. Prompt if still missing
if (-not $Repo) {
    $Repo = Read-Host 'Enter GitHub Repository (owner/repo, e.g. your-username/it-handover-signer)'
}
# Normalize repo
$Repo = $Repo.Trim()
if ($Repo -match 'github\.com[/:]([^/]+/[^/.]+)') {
    $Repo = $matches[1]
}

if (-not $Token) {
    $Token = Read-Host 'Enter GitHub Personal Access Token (PAT)'
}

if (-not $Repo -or -not $Token) {
    Write-Host 'Error: Both Repository and Token are required.' -ForegroundColor Red
    exit 1
}

$headers = @{
    'Authorization' = 'Bearer ' + $Token.Trim()
    'Accept'        = 'application/vnd.github+json'
    'User-Agent'    = 'IT-Handover-Signer-Cleanup/1.0'
}

Write-Host ('Connecting to GitHub (' + $Repo + ' - ' + $Branch + ')...') -ForegroundColor Yellow
$url = 'https://api.github.com/repos/' + $Repo + '/contents/pending?ref=' + $Branch

try {
    $items = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -TimeoutSec 15
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) {
        Write-Host 'Pending folder on GitHub is already empty or does not exist.' -ForegroundColor Green
        exit 0
    } else {
        Write-Host ('Failed to connect to GitHub: ' + $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}

$files = @($items | Where-Object { $_.type -eq 'file' -and $_.name -ne '.gitkeep' })

if ($files.Count -eq 0) {
    Write-Host 'GitHub pending folder is already clean (0 files found)!' -ForegroundColor Green
    exit 0
}

Write-Host ('Found ' + $files.Count + ' file(s) in GitHub pending folder:') -ForegroundColor Yellow
foreach ($f in $files) {
    Write-Host ('  - ' + $f.name + ' (' + $f.size + ' bytes)') -ForegroundColor Gray
}

$confirm = Read-Host ('
Do you want to permanently delete all ' + $files.Count + ' files from GitHub? (y/N)')
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host 'Operation cancelled.' -ForegroundColor Yellow
    exit 0
}

Write-Host ''
$deletedCount = 0

foreach ($f in $files) {
    $encoded = Quote-GitHubPath $f.path
    $deleteUrl = 'https://api.github.com/repos/' + $Repo + '/contents/' + $encoded
    $payload = @{
        message = ('Delete ' + $f.name + ' via cleanup script')
        sha     = $f.sha
        branch  = $Branch
    } | ConvertTo-Json

    try {
        $resp = Invoke-RestMethod -Uri $deleteUrl -Headers $headers -Method Delete -Body $payload -ContentType 'application/json'
        Write-Host ('  [DELETED] ' + $f.name) -ForegroundColor Green
        $deletedCount++
    } catch {
        Write-Host ('  [FAILED]  ' + $f.name + ': ' + $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ''
Write-Host ('Cleanup completed: ' + $deletedCount + ' of ' + $files.Count + ' file(s) deleted.') -ForegroundColor Cyan
