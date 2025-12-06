# FeedChecker Portable Build Script using Docker (Windows)
# Использует Docker для сборки frontend и подготовки Python зависимостей
# Затем собирает Electron приложение на хосте

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FeedChecker - Docker Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$PORTABLE_DIR = "portable"
$DOCKER_OUTPUT_DIR = "docker-build-output"

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check Docker
try {
    $dockerVersion = docker --version
    Write-Host "  [OK] Docker: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Docker not found! Please install Docker Desktop." -ForegroundColor Red
    Write-Host "  Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Check Node.js (для финальной сборки Electron)
try {
    $nodeVersion = node --version
    Write-Host "  [OK] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Node.js not found! Please install Node.js." -ForegroundColor Red
    exit 1
}

# Clean old build artifacts
if (Test-Path $DOCKER_OUTPUT_DIR) {
    Write-Host ""
    Write-Host "Removing old Docker build output..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $DOCKER_OUTPUT_DIR
}

if (Test-Path $PORTABLE_DIR) {
    Write-Host "Removing old portable directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PORTABLE_DIR
}

New-Item -ItemType Directory -Path $DOCKER_OUTPUT_DIR | Out-Null
New-Item -ItemType Directory -Path $PORTABLE_DIR | Out-Null

# Step 1: Build with Docker
Write-Host ""
Write-Host "Step 1: Building with Docker..." -ForegroundColor Cyan
Write-Host "  This will build frontend and prepare Python dependencies..." -ForegroundColor Gray

docker-compose -f docker-compose.build.yml build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Docker build failed!" -ForegroundColor Red
    exit 1
}

docker-compose -f docker-compose.build.yml up --abort-on-container-exit
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Docker export failed!" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Docker build completed" -ForegroundColor Green

# Step 2: Copy build artifacts
Write-Host ""
Write-Host "Step 2: Copying build artifacts..." -ForegroundColor Cyan

# Copy frontend build
if (Test-Path "$DOCKER_OUTPUT_DIR/renderer-dist") {
    Copy-Item -Path "$DOCKER_OUTPUT_DIR/renderer-dist" -Destination "renderer/dist" -Recurse -Force
    Write-Host "  [OK] Frontend build copied" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Frontend build not found!" -ForegroundColor Red
    exit 1
}

# Step 3: Build Electron app
Write-Host ""
Write-Host "Step 3: Building Electron app..." -ForegroundColor Cyan
npm run pack
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Electron build failed!" -ForegroundColor Red
    exit 1
}

$unpackedDir = "dist\win-unpacked"
if (-not (Test-Path $unpackedDir)) {
    Write-Host "  [ERROR] Unpacked directory not found!" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Electron app built" -ForegroundColor Green

# Step 4: Prepare Python for portable version
Write-Host ""
Write-Host "Step 4: Preparing Python environment..." -ForegroundColor Cyan

# Download Python Embeddable
$PYTHON_VERSION = "3.11.9"
$PYTHON_ARCH = "amd64"
$PYTHON_EMBED_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-$PYTHON_ARCH.zip"
$pythonZip = "$PORTABLE_DIR\python-embed.zip"
$pythonDir = "$PORTABLE_DIR\python"

try {
    Write-Host "  Downloading Python Embeddable..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $PYTHON_EMBED_URL -OutFile $pythonZip -UseBasicParsing
    Write-Host "  [OK] Python downloaded" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to download Python: $_" -ForegroundColor Red
    exit 1
}

# Extract Python
Write-Host "  Extracting Python..." -ForegroundColor Gray
Expand-Archive -Path $pythonZip -DestinationPath $pythonDir -Force
Remove-Item $pythonZip

# Configure Python
$pythonPthContent = "python311.zip`r`n.`r`nimport site"
$pythonPthContent | Out-File -FilePath "$pythonDir\python311._pth" -Encoding ASCII -NoNewline

# Install pip
Write-Host "  Installing pip..." -ForegroundColor Gray
$getPipScript = "$pythonDir\get-pip.py"
try {
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPipScript -UseBasicParsing
    & "$pythonDir\python.exe" $getPipScript --no-warn-script-location
    Remove-Item $getPipScript
    Write-Host "  [OK] pip installed" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to install pip: $_" -ForegroundColor Red
    exit 1
}

# Copy Python venv from Docker build
Write-Host "  Copying Python dependencies from Docker build..." -ForegroundColor Gray
if (Test-Path "$DOCKER_OUTPUT_DIR/python-venv") {
    # Копируем содержимое venv в embedded Python
    $pythonLibDir = "$pythonDir\Lib\site-packages"
    New-Item -ItemType Directory -Path $pythonLibDir -Force | Out-Null
    
    # Копируем пакеты из venv
    $venvSitePackages = "$DOCKER_OUTPUT_DIR\python-venv\lib\python3.11\site-packages"
    if (Test-Path $venvSitePackages) {
        Copy-Item -Path "$venvSitePackages\*" -Destination $pythonLibDir -Recurse -Force
        Write-Host "  [OK] Python dependencies copied" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Python venv not found, will install manually..." -ForegroundColor Yellow
        # Fallback: install dependencies manually
        $requirementsFile = "backend\requirements.txt"
        & "$pythonDir\python.exe" -m pip install --prefer-binary -r $requirementsFile
    }
} else {
    Write-Host "  [WARN] Python venv not found in Docker output, installing manually..." -ForegroundColor Yellow
    $requirementsFile = "backend\requirements.txt"
    & "$pythonDir\python.exe" -m pip install --prefer-binary -r $requirementsFile
}

# Step 5: Copy files to portable directory
Write-Host ""
Write-Host "Step 5: Copying application files..." -ForegroundColor Cyan

# Copy Electron app
Get-ChildItem -Path "$unpackedDir" -Recurse | ForEach-Object {
    $destPath = $_.FullName.Replace($unpackedDir, $PORTABLE_DIR)
    $destDir = Split-Path -Parent $destPath
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    try {
        Copy-Item -Path $_.FullName -Destination $destPath -Force -ErrorAction Stop
    } catch {
        Write-Warning "Не удалось скопировать $($_.Name): $_"
        Start-Sleep -Milliseconds 100
        Copy-Item -Path $_.FullName -Destination $destPath -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "  [OK] Electron app copied" -ForegroundColor Green

# Copy Python to resources
$pythonResourcesDir = "$PORTABLE_DIR\resources\python"
if (Test-Path $pythonResourcesDir) {
    Remove-Item -Recurse -Force $pythonResourcesDir
}
New-Item -ItemType Directory -Path $pythonResourcesDir -Force | Out-Null
Copy-Item -Path "$pythonDir\*" -Destination $pythonResourcesDir -Recurse -Force
Write-Host "  [OK] Python copied to resources" -ForegroundColor Green

# Copy backend
$backendResourcesDir = "$PORTABLE_DIR\resources\backend"
if (-not (Test-Path "$backendResourcesDir\app\main.py")) {
    Copy-Item -Path "backend\*" -Destination $backendResourcesDir -Recurse -Force
    Write-Host "  [OK] Backend copied" -ForegroundColor Green
} else {
    Write-Host "  [OK] Backend already present" -ForegroundColor Green
}

# Create marker file
$depsMarker = "$backendResourcesDir\.dependencies_installed"
(Get-Date).ToUniversalTime().ToString("o") | Out-File -FilePath $depsMarker -Encoding ASCII
Write-Host "  [OK] Dependencies marker created" -ForegroundColor Green

# Remove temporary Python folder
Remove-Item -Recurse -Force $pythonDir

# Step 6: Create README
Write-Host ""
Write-Host "Step 6: Creating README..." -ForegroundColor Cyan
$readmeLines = @(
    "# FeedChecker Portable (Built with Docker)",
    "",
    "Portable version of FeedChecker - no installation required!",
    "",
    "## How to Run",
    "",
    "Just run FeedChecker.exe from this folder.",
    "",
    "## What's Included",
    "",
    "- Electron application",
    "- Embedded Python 3.11.9",
    "- All Python dependencies pre-installed",
    "- Backend ready to work",
    "",
    "## Requirements",
    "",
    "- Windows 10/11 (64-bit)",
    "- Nothing else required!",
    "",
    "## Notes",
    "",
    "- All files must stay in this folder",
    "- Do not move individual files",
    "- Firewall permission may be required on first run",
    "",
    "## Build Info",
    "",
    "This version was built using Docker for consistent builds across platforms.",
    "",
    "## Technical Details",
    "",
    "- Python 3.11.9 (embeddable)",
    "- All Python dependencies pre-installed",
    "- Does not require system Python",
    "- Fully portable version"
)
$readmeLines -join "`r`n" | Out-File -FilePath "$PORTABLE_DIR\README.txt" -Encoding UTF8
Write-Host "  [OK] README created" -ForegroundColor Green

# Cleanup Docker output (optional)
Write-Host ""
Write-Host "Cleaning up Docker build artifacts..." -ForegroundColor Cyan
# Можно оставить для отладки или удалить
# Remove-Item -Recurse -Force $DOCKER_OUTPUT_DIR

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Portable build completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Portable version location: $((Get-Location).Path)\$PORTABLE_DIR" -ForegroundColor Cyan
Write-Host ""
Write-Host "You can now distribute the entire '$PORTABLE_DIR' folder." -ForegroundColor Yellow
Write-Host "Users just need to run FeedChecker.exe from that folder." -ForegroundColor Yellow
Write-Host ""

