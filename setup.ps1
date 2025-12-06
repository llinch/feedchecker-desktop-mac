# Скрипт для настройки проекта FeedChecker Desktop

Write-Host "Setting up FeedChecker Desktop..." -ForegroundColor Green

# Копирование фронтенда
Write-Host "Copying frontend files..." -ForegroundColor Yellow
if (Test-Path "renderer") {
    Remove-Item -Recurse -Force "renderer"
}
New-Item -ItemType Directory -Path "renderer" -Force | Out-Null
Copy-Item -Recurse -Force "..\any-feedchecker\apps\frontend\*" "renderer\"

# Копирование бэкенда
Write-Host "Copying backend files..." -ForegroundColor Yellow
if (Test-Path "backend") {
    Remove-Item -Recurse -Force "backend"
}
New-Item -ItemType Directory -Path "backend" -Force | Out-Null
Copy-Item -Recurse -Force "..\any-feedchecker\apps\backend\*" "backend\"

Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. npm install" -ForegroundColor White
Write-Host "2. cd renderer && npm install" -ForegroundColor White
Write-Host "3. cd ../backend && pip install -r requirements.txt" -ForegroundColor White
Write-Host "4. cd .. && npm run dev" -ForegroundColor White


