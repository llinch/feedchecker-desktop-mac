# FeedChecker Portable Build Script
# Creates portable/ folder with fully working application

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FeedChecker - Portable Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$PYTHON_VERSION = "3.11.9"
$PYTHON_ARCH = "amd64"
$PORTABLE_DIR = "portable"
$PYTHON_EMBED_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-$PYTHON_ARCH.zip"

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "  [OK] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Node.js not found! Please install Node.js." -ForegroundColor Red
    exit 1
}

# Check Python (for installing dependencies)
# Note: Python is needed to install dependencies into the embedded Python
$pythonCmd = $null

# Try 'py' launcher first (Windows Python Launcher)
$pyCmd = Get-Command "py" -ErrorAction SilentlyContinue
if ($pyCmd) {
    try {
        # Try to get Python version
        $null = & py -3 --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonCmd = "py"
            $versionOutput = & py -3 --version 2>&1 | Out-String
            Write-Host "  [OK] Python: $($versionOutput.Trim())" -ForegroundColor Green
        }
    } catch {
        # py launcher exists but may not have Python
    }
}

# If py didn't work, try 'python'
if (-not $pythonCmd) {
    $pythonCmdCheck = Get-Command "python" -ErrorAction SilentlyContinue
    if ($pythonCmdCheck) {
        try {
            $versionOutput = & python --version 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0 -or $versionOutput -match "Python") {
                $pythonCmd = "python"
                Write-Host "  [OK] Python: $($versionOutput.Trim())" -ForegroundColor Green
            }
        } catch {
            # python command exists but may not work
        }
    }
}

if (-not $pythonCmd) {
    Write-Host "  [ERROR] Python not found! Please install Python 3.11+." -ForegroundColor Red
    Write-Host "  Note: Python is needed only during build to install dependencies." -ForegroundColor Yellow
    Write-Host "  The portable version will include its own Python." -ForegroundColor Yellow
    Write-Host "  Download from: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Clean old portable version
if (Test-Path $PORTABLE_DIR) {
    Write-Host ""
    Write-Host "Removing old portable directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PORTABLE_DIR
}

New-Item -ItemType Directory -Path $PORTABLE_DIR | Out-Null
Write-Host "  [OK] Created portable directory" -ForegroundColor Green

# Step 1: Build frontend
Write-Host ""
Write-Host "Step 1: Building frontend..." -ForegroundColor Cyan
Set-Location renderer
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Frontend build failed!" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Set-Location ..
Write-Host "  [OK] Frontend built successfully" -ForegroundColor Green

# Step 2: Build Electron app (without installer)
Write-Host ""
Write-Host "Step 2: Building Electron app..." -ForegroundColor Cyan
npm run pack
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Electron build failed!" -ForegroundColor Red
    exit 1
}

# Copy unpacked application
$unpackedDir = "dist\win-unpacked"
if (-not (Test-Path $unpackedDir)) {
    Write-Host "  [ERROR] Unpacked directory not found!" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Electron app built" -ForegroundColor Green

# Step 3: Download Python Embeddable
Write-Host ""
Write-Host "Step 3: Downloading Python Embeddable..." -ForegroundColor Cyan
$pythonZip = "$PORTABLE_DIR\python-embed.zip"
$pythonDir = "$PORTABLE_DIR\python"

try {
    Write-Host "  Downloading from $PYTHON_EMBED_URL..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $PYTHON_EMBED_URL -OutFile $pythonZip -UseBasicParsing
    Write-Host "  [OK] Python downloaded" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to download Python: $_" -ForegroundColor Red
    Write-Host "  You can download manually from:" -ForegroundColor Yellow
    Write-Host "  $PYTHON_EMBED_URL" -ForegroundColor Yellow
    exit 1
}

# Extract Python
Write-Host "  Extracting Python..." -ForegroundColor Gray
Expand-Archive -Path $pythonZip -DestinationPath $pythonDir -Force
Remove-Item $pythonZip
Write-Host "  [OK] Python extracted" -ForegroundColor Green

# Step 4: Configure Python
Write-Host ""
Write-Host "Step 4: Configuring Python..." -ForegroundColor Cyan

# Create python._pth with correct paths
$pythonPthContent = "python311.zip`r`n.`r`nimport site"
$pythonPthContent | Out-File -FilePath "$pythonDir\python311._pth" -Encoding ASCII -NoNewline

# Install pip in embedded Python
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

# Step 5: Install Python dependencies
Write-Host ""
Write-Host "Step 5: Installing Python dependencies..." -ForegroundColor Cyan
Write-Host "  This may take several minutes..." -ForegroundColor Gray

$pythonExe = "$pythonDir\python.exe"
$backendDir = "backend"
$requirementsFile = "$backendDir\requirements.txt"

# Update pip
& $pythonExe -m pip install --upgrade pip wheel --quiet

# Install dependencies with preference for binary packages
& $pythonExe -m pip install --prefer-binary -r $requirementsFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [WARN] Retrying without --prefer-binary..." -ForegroundColor Yellow
    & $pythonExe -m pip install -r $requirementsFile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] Failed to install dependencies!" -ForegroundColor Red
        exit 1
    }
}

Write-Host "  [OK] Dependencies installed" -ForegroundColor Green

# Step 6: Copy files
Write-Host ""
Write-Host "Step 6: Copying application files..." -ForegroundColor Cyan

# Copy Electron app
# Копируем файлы с обработкой ошибок доступа
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
        # Пробуем еще раз после небольшой задержки
        Start-Sleep -Milliseconds 100
        Copy-Item -Path $_.FullName -Destination $destPath -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "  [OK] Electron app copied" -ForegroundColor Green

# Copy Python to resources (remove old folder if exists)
$pythonResourcesDir = "$PORTABLE_DIR\resources\python"
if (Test-Path $pythonResourcesDir) {
    Remove-Item -Recurse -Force $pythonResourcesDir
}
New-Item -ItemType Directory -Path $pythonResourcesDir -Force | Out-Null
Copy-Item -Path "$pythonDir\*" -Destination $pythonResourcesDir -Recurse -Force
Write-Host "  [OK] Python copied to resources" -ForegroundColor Green

# Ensure backend is copied
$backendResourcesDir = "$PORTABLE_DIR\resources\backend"
if (-not (Test-Path "$backendResourcesDir\app\main.py")) {
    Copy-Item -Path "$backendDir\*" -Destination $backendResourcesDir -Recurse -Force
    Write-Host "  [OK] Backend copied" -ForegroundColor Green
} else {
    Write-Host "  [OK] Backend already present" -ForegroundColor Green
}

# Create marker file that dependencies are installed
$depsMarker = "$backendResourcesDir\.dependencies_installed"
(Get-Date).ToUniversalTime().ToString("o") | Out-File -FilePath $depsMarker -Encoding ASCII
Write-Host "  [OK] Dependencies marker created" -ForegroundColor Green

# Remove temporary Python folder
Remove-Item -Recurse -Force $pythonDir

# Remove unnecessary installer files
Write-Host ""
Write-Host "Cleaning up unnecessary files..." -ForegroundColor Cyan
$filesToRemove = @(
    "$PORTABLE_DIR\install-dependencies.bat",
    "$PORTABLE_DIR\install-dependencies-safe.bat",
    "$PORTABLE_DIR\TROUBLESHOOTING.md",
    "$PORTABLE_DIR\QUICK_FIX.md",
    "$PORTABLE_DIR\AUTO_INSTALL_INFO.md"
)
foreach ($file in $filesToRemove) {
    if (Test-Path $file) {
        Remove-Item -Force $file
        Write-Host "  [OK] Removed $(Split-Path $file -Leaf)" -ForegroundColor Gray
    }
}

# Step 7: Create README
Write-Host ""
Write-Host "Step 7: Creating README..." -ForegroundColor Cyan
$readmeLines = @(
    "# FeedChecker Portable",
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
    "## Size",
    "",
    "Approximately 200-300 MB (including Python and all dependencies)",
    "",
    "## Update",
    "",
    "To update, just replace the entire folder with a new version.",
    "",
    "## Technical Details",
    "",
    "- Python 3.11.9 (embeddable)",
    "- All Python dependencies pre-installed",
    "- Does not require system Python",
    "- Does not require dependency installation",
    "- Fully portable version"
)
$readmeLines -join "`r`n" | Out-File -FilePath "$PORTABLE_DIR\README.txt" -Encoding UTF8

Write-Host "  [OK] README created" -ForegroundColor Green

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
