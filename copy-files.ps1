# Script for copying files from any-feedchecker

$ErrorActionPreference = "Stop"

Write-Host "=== FeedChecker Desktop Setup ===" -ForegroundColor Green
Write-Host ""

# Check source folders
$frontendSource = "..\any-feedchecker\apps\frontend"
$backendSource = "..\any-feedchecker\apps\backend"

if (-not (Test-Path $frontendSource)) {
    Write-Host "Error: folder not found $frontendSource" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $backendSource)) {
    Write-Host "Error: folder not found $backendSource" -ForegroundColor Red
    exit 1
}

# Copy frontend
Write-Host "Copying frontend..." -ForegroundColor Yellow
if (Test-Path "renderer") {
    Remove-Item -Recurse -Force "renderer"
}
New-Item -ItemType Directory -Path "renderer" -Force | Out-Null
Copy-Item -Recurse -Force "$frontendSource\*" "renderer\"
Write-Host "Frontend copied" -ForegroundColor Green

# Copy backend
Write-Host "Copying backend..." -ForegroundColor Yellow
if (Test-Path "backend") {
    Remove-Item -Recurse -Force "backend"
}
New-Item -ItemType Directory -Path "backend" -Force | Out-Null
Copy-Item -Recurse -Force "$backendSource\*" "backend\"
Write-Host "Backend copied" -ForegroundColor Green

# Clean backend
Write-Host "Cleaning backend..." -ForegroundColor Yellow
$excludePatterns = @("__pycache__", "*.pyc", ".git", "node_modules", "*.log")
Get-ChildItem -Path "backend" -Recurse | Where-Object {
    $item = $_
    $excludePatterns | ForEach-Object {
        if ($item.Name -like $_ -or $item.FullName -like "*\__pycache__\*") {
            Remove-Item -Recurse -Force $item.FullName -ErrorAction SilentlyContinue
        }
    }
}
Write-Host "Cleaning completed" -ForegroundColor Green

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. npm install" -ForegroundColor White
Write-Host "2. cd renderer; npm install; cd .." -ForegroundColor White
Write-Host "3. cd backend; pip install -r requirements.txt; cd .." -ForegroundColor White
Write-Host "4. npm run dev" -ForegroundColor White

