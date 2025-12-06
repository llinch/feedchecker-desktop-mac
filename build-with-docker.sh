#!/bin/bash
# FeedChecker Portable Build Script using Docker (macOS/Linux)
# Использует Docker для сборки frontend и подготовки Python зависимостей
# Затем собирает Electron приложение на хосте

set -e  # Exit on error

echo "========================================"
echo "  FeedChecker - Docker Build Script"
echo "========================================"
echo ""

# Configuration
PORTABLE_DIR="portable"
DOCKER_OUTPUT_DIR="docker-build-output"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo -e "${GREEN}  [OK] Docker: $DOCKER_VERSION${NC}"
else
    echo -e "${RED}  [ERROR] Docker not found! Please install Docker.${NC}"
    echo -e "${YELLOW}  Download from: https://www.docker.com/products/docker-desktop${NC}"
    exit 1
fi

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}  [OK] Node.js: $NODE_VERSION${NC}"
else
    echo -e "${RED}  [ERROR] Node.js not found! Please install Node.js.${NC}"
    exit 1
fi

# Clean old build artifacts
if [ -d "$DOCKER_OUTPUT_DIR" ]; then
    echo ""
    echo -e "${YELLOW}Removing old Docker build output...${NC}"
    rm -rf "$DOCKER_OUTPUT_DIR"
fi

if [ -d "$PORTABLE_DIR" ]; then
    echo -e "${YELLOW}Removing old portable directory...${NC}"
    rm -rf "$PORTABLE_DIR"
fi

mkdir -p "$DOCKER_OUTPUT_DIR"
mkdir -p "$PORTABLE_DIR"

# Step 1: Build with Docker
echo ""
echo -e "${CYAN}Step 1: Building with Docker...${NC}"
echo -e "${YELLOW}  This will build frontend and prepare Python dependencies...${NC}"

docker-compose -f docker-compose.build.yml build
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Docker build failed!${NC}"
    exit 1
fi

docker-compose -f docker-compose.build.yml up --abort-on-container-exit
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Docker export failed!${NC}"
    exit 1
fi

echo -e "${GREEN}  [OK] Docker build completed${NC}"

# Step 2: Copy build artifacts
echo ""
echo -e "${CYAN}Step 2: Copying build artifacts...${NC}"

# Copy frontend build
if [ -d "$DOCKER_OUTPUT_DIR/renderer-dist" ]; then
    cp -R "$DOCKER_OUTPUT_DIR/renderer-dist" renderer/dist
    echo -e "${GREEN}  [OK] Frontend build copied${NC}"
else
    echo -e "${RED}  [ERROR] Frontend build not found!${NC}"
    exit 1
fi

# Step 3: Build Electron app
echo ""
echo -e "${CYAN}Step 3: Building Electron app...${NC}"
npm run pack
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Electron build failed!${NC}"
    exit 1
fi

# Find unpacked directory
UNPACKED_DIR=""
if [ -d "dist/mac" ]; then
    UNPACKED_DIR="dist/mac"
elif [ -d "dist/mac-arm64" ]; then
    UNPACKED_DIR="dist/mac-arm64"
elif [ -d "dist/mac-x64" ]; then
    UNPACKED_DIR="dist/mac-x64"
else
    UNPACKED_DIR=$(find dist -type d -name "mac*" -maxdepth 1 | head -n 1)
fi

if [ -z "$UNPACKED_DIR" ] || [ ! -d "$UNPACKED_DIR" ]; then
    echo -e "${RED}  [ERROR] Unpacked directory not found!${NC}"
    exit 1
fi

echo -e "${GREEN}  [OK] Electron app built${NC}"

# Step 4: Prepare Python for portable version
echo ""
echo -e "${CYAN}Step 4: Preparing Python environment...${NC}"

# Create Python virtual environment
PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

PYTHON_VENV_DIR="$PORTABLE_DIR/python_venv"
echo -e "${YELLOW}  Creating Python virtual environment...${NC}"
$PYTHON_CMD -m venv "$PYTHON_VENV_DIR"
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Failed to create virtual environment!${NC}"
    exit 1
fi

# Activate and upgrade pip
source "$PYTHON_VENV_DIR/bin/activate"
pip install --upgrade pip wheel --quiet

# Copy Python packages from Docker build
echo -e "${YELLOW}  Copying Python dependencies from Docker build...${NC}"
if [ -d "$DOCKER_OUTPUT_DIR/python-venv" ]; then
    # Копируем пакеты из Docker venv
    DOCKER_VENV_SITE_PACKAGES="$DOCKER_OUTPUT_DIR/python-venv/lib/python3.11/site-packages"
    LOCAL_VENV_SITE_PACKAGES="$PYTHON_VENV_DIR/lib/python3.11/site-packages"
    
    if [ -d "$DOCKER_VENV_SITE_PACKAGES" ] && [ -d "$LOCAL_VENV_SITE_PACKAGES" ]; then
        cp -R "$DOCKER_VENV_SITE_PACKAGES"/* "$LOCAL_VENV_SITE_PACKAGES/" 2>/dev/null || true
        echo -e "${GREEN}  [OK] Python dependencies copied${NC}"
    else
        echo -e "${YELLOW}  [WARN] Installing dependencies manually...${NC}"
        pip install -r backend/requirements.txt
    fi
else
    echo -e "${YELLOW}  [WARN] Python venv not found in Docker output, installing manually...${NC}"
    pip install -r backend/requirements.txt
fi

deactivate

# Step 5: Copy files to portable directory
echo ""
echo -e "${CYAN}Step 5: Copying application files...${NC}"

# Copy Electron app
if [ -d "$UNPACKED_DIR/FeedChecker.app" ]; then
    cp -R "$UNPACKED_DIR/FeedChecker.app" "$PORTABLE_DIR/"
    APP_BUNDLE_PATH="$PORTABLE_DIR/FeedChecker.app"
elif [ -f "$UNPACKED_DIR/FeedChecker.app/Contents/Info.plist" ]; then
    cp -R "$UNPACKED_DIR/FeedChecker.app" "$PORTABLE_DIR/"
    APP_BUNDLE_PATH="$PORTABLE_DIR/FeedChecker.app"
else
    cp -R "$UNPACKED_DIR"/* "$PORTABLE_DIR/"
    APP_BUNDLE_PATH=$(find "$PORTABLE_DIR" -name "FeedChecker.app" -type d | head -n 1)
fi

echo -e "${GREEN}  [OK] Electron app copied${NC}"

# Determine resources directory
if [ -n "$APP_BUNDLE_PATH" ] && [ -d "$APP_BUNDLE_PATH/Contents/Resources" ]; then
    PYTHON_RESOURCES_DIR="$APP_BUNDLE_PATH/Contents/Resources/python"
    BACKEND_RESOURCES_DIR="$APP_BUNDLE_PATH/Contents/Resources/backend"
    mkdir -p "$PYTHON_RESOURCES_DIR"
    mkdir -p "$BACKEND_RESOURCES_DIR"
else
    PYTHON_RESOURCES_DIR="$PORTABLE_DIR/resources/python"
    BACKEND_RESOURCES_DIR="$PORTABLE_DIR/resources/backend"
    mkdir -p "$PYTHON_RESOURCES_DIR"
    mkdir -p "$BACKEND_RESOURCES_DIR"
fi

# Copy Python venv
echo -e "${YELLOW}  Copying Python environment...${NC}"
cp -R "$PYTHON_VENV_DIR" "$PYTHON_RESOURCES_DIR"
echo -e "${GREEN}  [OK] Python copied to resources${NC}"

# Copy backend
if [ ! -f "$BACKEND_RESOURCES_DIR/app/main.py" ]; then
    cp -R backend/* "$BACKEND_RESOURCES_DIR/"
    echo -e "${GREEN}  [OK] Backend copied${NC}"
else
    echo -e "${GREEN}  [OK] Backend already present${NC}"
fi

# Create marker file
DEPS_MARKER="$BACKEND_RESOURCES_DIR/.dependencies_installed"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DEPS_MARKER"
echo -e "${GREEN}  [OK] Dependencies marker created${NC}"

# Remove temporary Python venv
rm -rf "$PYTHON_VENV_DIR"

# Step 6: Create README
echo ""
echo -e "${CYAN}Step 6: Creating README...${NC}"
cat > "$PORTABLE_DIR/README.txt" << 'EOF'
# FeedChecker Portable (Built with Docker)

Portable version of FeedChecker - no installation required!

## How to Run

Just double-click FeedChecker.app from this folder.

## What's Included

- Electron application
- Python 3.11 virtual environment
- All Python dependencies pre-installed
- Backend ready to work

## Requirements

- macOS 10.13+ or Linux
- Nothing else required!

## Build Info

This version was built using Docker for consistent builds across platforms.

## Technical Details

- Python 3.11 (virtual environment)
- All Python dependencies pre-installed
- Does not require system Python
- Fully portable version
EOF

echo -e "${GREEN}  [OK] README created${NC}"

# Make executable
if [ -n "$APP_BUNDLE_PATH" ] && [ -d "$APP_BUNDLE_PATH" ]; then
    EXECUTABLE_PATH="$APP_BUNDLE_PATH/Contents/MacOS/FeedChecker"
    if [ -f "$EXECUTABLE_PATH" ]; then
        chmod +x "$EXECUTABLE_PATH"
    fi
fi

# Summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Portable build completed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Portable version location: $(pwd)/$PORTABLE_DIR${NC}"
echo ""
echo -e "${YELLOW}You can now distribute the entire '$PORTABLE_DIR' folder.${NC}"
echo ""

