#!/bin/bash
# FeedChecker Portable Build Script for macOS
# Creates portable/ folder with fully working application

set -e  # Exit on error

echo "========================================"
echo "  FeedChecker - Portable Build Script (macOS)"
echo "========================================"
echo ""

# Configuration
PYTHON_VERSION="3.11"
PORTABLE_DIR="portable"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}  [OK] Node.js: $NODE_VERSION${NC}"
else
    echo -e "${RED}  [ERROR] Node.js not found! Please install Node.js.${NC}"
    exit 1
fi

# Check Python
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_VERSION_OUT=$(python3 --version 2>&1)
    PYTHON_CMD="python3"
    echo -e "${GREEN}  [OK] Python: $PYTHON_VERSION_OUT${NC}"
elif command -v python &> /dev/null; then
    PYTHON_VERSION_OUT=$(python --version 2>&1)
    PYTHON_CMD="python"
    echo -e "${GREEN}  [OK] Python: $PYTHON_VERSION_OUT${NC}"
else
    echo -e "${RED}  [ERROR] Python not found! Please install Python 3.11+.${NC}"
    echo -e "${YELLOW}  Note: Python is needed only during build to install dependencies.${NC}"
    echo -e "${YELLOW}  The portable version will include its own Python environment.${NC}"
    echo -e "${YELLOW}  Install with: brew install python@3.11${NC}"
    exit 1
fi

# Clean old portable version
if [ -d "$PORTABLE_DIR" ]; then
    echo ""
    echo -e "${YELLOW}Removing old portable directory...${NC}"
    rm -rf "$PORTABLE_DIR"
fi

mkdir -p "$PORTABLE_DIR"
echo -e "${GREEN}  [OK] Created portable directory${NC}"

# Step 1: Build frontend
echo ""
echo -e "${CYAN}Step 1: Building frontend...${NC}"
cd renderer
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Frontend build failed!${NC}"
    cd ..
    exit 1
fi
cd ..
echo -e "${GREEN}  [OK] Frontend built successfully${NC}"

# Step 2: Build Electron app (without installer)
echo ""
echo -e "${CYAN}Step 2: Building Electron app...${NC}"
npm run pack
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Electron build failed!${NC}"
    exit 1
fi

# Find unpacked application directory
UNPACKED_DIR=""
if [ -d "dist/mac" ]; then
    UNPACKED_DIR="dist/mac"
elif [ -d "dist/mac-arm64" ]; then
    UNPACKED_DIR="dist/mac-arm64"
elif [ -d "dist/mac-x64" ]; then
    UNPACKED_DIR="dist/mac-x64"
else
    # Try to find any mac directory or .app bundle
    UNPACKED_DIR=$(find dist -type d -name "mac*" -maxdepth 1 | head -n 1)
    if [ -z "$UNPACKED_DIR" ]; then
        # Try to find .app bundle
        APP_BUNDLE=$(find dist -name "FeedChecker.app" -type d | head -n 1)
        if [ -n "$APP_BUNDLE" ]; then
            UNPACKED_DIR=$(dirname "$APP_BUNDLE")
        fi
    fi
fi

if [ -z "$UNPACKED_DIR" ] || [ ! -d "$UNPACKED_DIR" ]; then
    echo -e "${RED}  [ERROR] Unpacked directory not found!${NC}"
    echo -e "${YELLOW}  Expected: dist/mac or dist/mac-arm64 or dist/mac-x64${NC}"
    echo -e "${YELLOW}  Or FeedChecker.app in dist/ directory${NC}"
    exit 1
fi

echo -e "${GREEN}  [OK] Electron app built${NC}"

# Step 3: Create Python virtual environment
echo ""
echo -e "${CYAN}Step 3: Creating Python virtual environment...${NC}"
PYTHON_VENV_DIR="$PORTABLE_DIR/python_venv"

# Create virtual environment
$PYTHON_CMD -m venv "$PYTHON_VENV_DIR"
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Failed to create virtual environment!${NC}"
    exit 1
fi

# Activate virtual environment
source "$PYTHON_VENV_DIR/bin/activate"

# Upgrade pip
echo -e "${YELLOW}  Upgrading pip...${NC}"
pip install --upgrade pip wheel --quiet

echo -e "${GREEN}  [OK] Virtual environment created${NC}"

# Step 4: Install Python dependencies
echo ""
echo -e "${CYAN}Step 4: Installing Python dependencies...${NC}"
echo -e "${YELLOW}  This may take several minutes...${NC}"

BACKEND_DIR="backend"
REQUIREMENTS_FILE="$BACKEND_DIR/requirements.txt"

# Install dependencies
pip install -r "$REQUIREMENTS_FILE"
if [ $? -ne 0 ]; then
    echo -e "${RED}  [ERROR] Failed to install dependencies!${NC}"
    deactivate
    exit 1
fi

echo -e "${GREEN}  [OK] Dependencies installed${NC}"

# Deactivate virtual environment
deactivate

# Step 5: Copy files
echo ""
echo -e "${CYAN}Step 5: Copying application files...${NC}"

# Copy Electron app
echo -e "${YELLOW}  Copying Electron app...${NC}"
# Check if we're copying a .app bundle or a directory
if [ -d "$UNPACKED_DIR/FeedChecker.app" ]; then
    # Copy the .app bundle
    cp -R "$UNPACKED_DIR/FeedChecker.app" "$PORTABLE_DIR/"
    APP_BUNDLE_PATH="$PORTABLE_DIR/FeedChecker.app"
elif [ -f "$UNPACKED_DIR/FeedChecker.app/Contents/Info.plist" ]; then
    # Already a .app bundle
    cp -R "$UNPACKED_DIR/FeedChecker.app" "$PORTABLE_DIR/"
    APP_BUNDLE_PATH="$PORTABLE_DIR/FeedChecker.app"
else
    # Copy all files
    cp -R "$UNPACKED_DIR"/* "$PORTABLE_DIR/"
    # Try to find .app bundle in portable dir
    APP_BUNDLE_PATH=$(find "$PORTABLE_DIR" -name "FeedChecker.app" -type d | head -n 1)
fi

echo -e "${GREEN}  [OK] Electron app copied${NC}"

# Determine Python resources directory
if [ -n "$APP_BUNDLE_PATH" ] && [ -d "$APP_BUNDLE_PATH/Contents/Resources" ]; then
    PYTHON_RESOURCES_DIR="$APP_BUNDLE_PATH/Contents/Resources/python"
    BACKEND_RESOURCES_DIR="$APP_BUNDLE_PATH/Contents/Resources/backend"
    mkdir -p "$PYTHON_RESOURCES_DIR"
    mkdir -p "$BACKEND_RESOURCES_DIR"
else
    # Fallback to resources directory
    PYTHON_RESOURCES_DIR="$PORTABLE_DIR/resources/python"
    BACKEND_RESOURCES_DIR="$PORTABLE_DIR/resources/backend"
    mkdir -p "$PYTHON_RESOURCES_DIR"
    mkdir -p "$BACKEND_RESOURCES_DIR"
fi

# Remove old Python folder if exists
if [ -d "$PYTHON_RESOURCES_DIR" ]; then
    rm -rf "$PYTHON_RESOURCES_DIR"
fi

echo -e "${YELLOW}  Copying Python environment...${NC}"
cp -R "$PYTHON_VENV_DIR" "$PYTHON_RESOURCES_DIR"
echo -e "${GREEN}  [OK] Python copied to resources${NC}"

# Copy backend (if not already present)
if [ ! -f "$BACKEND_RESOURCES_DIR/app/main.py" ]; then
    cp -R "$BACKEND_DIR"/* "$BACKEND_RESOURCES_DIR/"
    echo -e "${GREEN}  [OK] Backend copied${NC}"
else
    echo -e "${GREEN}  [OK] Backend already present${NC}"
fi

# Create marker file that dependencies are installed
DEPS_MARKER="$BACKEND_RESOURCES_DIR/.dependencies_installed"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DEPS_MARKER"
echo -e "${GREEN}  [OK] Dependencies marker created${NC}"

# Remove temporary Python virtual environment
rm -rf "$PYTHON_VENV_DIR"

# Step 6: Create README
echo ""
echo -e "${CYAN}Step 6: Creating README...${NC}"
cat > "$PORTABLE_DIR/README.txt" << 'EOF'
# FeedChecker Portable (macOS)

Portable version of FeedChecker - no installation required!

## How to Run

Just double-click FeedChecker.app from this folder.

Or run from terminal:
  open FeedChecker.app

## What's Included

- Electron application
- Python 3.11 virtual environment
- All Python dependencies pre-installed
- Backend ready to work

## Requirements

- macOS 10.13 (High Sierra) or later
- Nothing else required!

## Notes

- All files must stay in this folder
- Do not move individual files
- On first run, macOS may ask for permission to run the app

## If you see "App is damaged" error

If macOS shows "FeedChecker.app is damaged and should be moved to the Trash", 
this is a Gatekeeper security warning. To fix it:

**Option 1: Use the fix script (Easiest)**
Double-click `fix-macos-gatekeeper.sh` or run in Terminal:
```bash
cd /path/to/portable
./fix-macos-gatekeeper.sh
```

**Option 2: Remove quarantine manually**
Open Terminal and run:
```bash
cd /path/to/portable
xattr -cr FeedChecker.app
```

**Option 3: Right-click and Open**
1. Right-click (or Control+click) on FeedChecker.app
2. Select "Open" from the context menu
3. Click "Open" in the security dialog
4. The app will be added to your security exceptions

**Option 4: System Settings**
1. Go to System Settings > Privacy & Security
2. Scroll down to "Security"
3. If you see a message about FeedChecker, click "Open Anyway"

## Size

Approximately 200-300 MB (including Python and all dependencies)

## Update

To update, just replace the entire folder with a new version.

## Technical Details

- Python 3.11 (virtual environment)
- All Python dependencies pre-installed
- Does not require system Python
- Does not require dependency installation
- Fully portable version
EOF

echo -e "${GREEN}  [OK] README created${NC}"

# Copy fix script for users
if [ -f "fix-macos-gatekeeper.sh" ]; then
    cp "fix-macos-gatekeeper.sh" "$PORTABLE_DIR/"
    chmod +x "$PORTABLE_DIR/fix-macos-gatekeeper.sh"
    echo -e "${GREEN}  [OK] Gatekeeper fix script copied${NC}"
fi

# Make FeedChecker.app executable and remove quarantine
if [ -n "$APP_BUNDLE_PATH" ] && [ -d "$APP_BUNDLE_PATH" ]; then
    EXECUTABLE_PATH="$APP_BUNDLE_PATH/Contents/MacOS/FeedChecker"
    if [ -f "$EXECUTABLE_PATH" ]; then
        chmod +x "$EXECUTABLE_PATH"
        echo -e "${GREEN}  [OK] Made executable${NC}"
    fi
    
    # Remove quarantine attribute to prevent Gatekeeper warning
    echo -e "${YELLOW}  Removing quarantine attribute...${NC}"
    xattr -cr "$APP_BUNDLE_PATH" 2>/dev/null || true
    echo -e "${GREEN}  [OK] Quarantine removed${NC}"
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
echo -e "${YELLOW}Users just need to run FeedChecker.app from that folder.${NC}"
echo ""

