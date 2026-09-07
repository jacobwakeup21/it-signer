# ==============================================================================
#  IT Handover Signer - Automatic Signed PDFs Sync to Local PC Folder
# ==============================================================================
param (
    [string]$ServerUrl = "https://it-handover-signer.onrender.com",
    [string]$DestinationFolder = "$HOME\OneDrive - Nokian Tyres\Signed Handover Documents",
    [switch]$Watch = $true,
    [int]$IntervalSeconds = 15
)

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  IT Handover Signer - Local PC Folder Sync" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Server URL:         $ServerUrl" -ForegroundColor Yellow
Write-Host "Destination Folder: $DestinationFolder" -ForegroundColor Yellow
Write-Host ""

# Ensure target folder exists
if (-not (Test-Path $DestinationFolder)) {
    New-Item -ItemType Directory -Path $DestinationFolder -Force | Out-Null
    Write-Host "Created target folder: $DestinationFolder" -ForegroundColor Green
}

function Sync-SignedFiles {
    try {
        $apiEndpoint = "$($ServerUrl.TrimEnd('/'))/api/documents"
        $resp = Invoke-RestMethod -Uri $apiEndpoint -Method Get -TimeoutSec 10
        $signedDocs = $resp.signed
        
        if (-not $signedDocs -or $signedDocs.Count -eq 0) {
            return
        }

        foreach ($doc in $signedDocs) {
            $filename = $doc.name
            $localPath = Join-Path $DestinationFolder $filename

            if (-not (Test-Path $localPath)) {
                $downloadUrl = "$($ServerUrl.TrimEnd('/'))/download/signed/$([System.Uri]::EscapeDataString($filename))"
                Write-Host "Downloading new signed document: $filename ..." -ForegroundColor Cyan
                Invoke-WebRequest -Uri $downloadUrl -OutFile $localPath
                Write-Host "  [SAVED] -> $localPath" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "Sync notice: $($_.Exception.Message)" -ForegroundColor Gray
    }
}

if ($Watch) {
    Write-Host "Watching for new signed documents (polling every $IntervalSeconds seconds)..." -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray
    while ($true) {
        Sync-SignedFiles
        Start-Sleep -Seconds $IntervalSeconds
    }
} else {
    Sync-SignedFiles
    Write-Host "Sync completed." -ForegroundColor Green
}
