#!/bin/bash
# Script to fix macOS Gatekeeper "app is damaged" error
# Run this script after extracting the portable version

set -e

APP_NAME="FeedChecker.app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="$SCRIPT_DIR/$APP_NAME"

echo "========================================"
echo "  Fix macOS Gatekeeper Error"
echo "========================================"
echo ""

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: $APP_NAME not found in current directory"
    echo "   Please run this script from the portable/ folder"
    exit 1
fi

echo "Removing quarantine attribute from $APP_NAME..."
xattr -cr "$APP_PATH"

if [ $? -eq 0 ]; then
    echo "✅ Success! Quarantine removed."
    echo ""
    echo "You can now open FeedChecker.app normally."
    echo ""
    echo "If you still see a warning:"
    echo "  1. Right-click on FeedChecker.app"
    echo "  2. Select 'Open'"
    echo "  3. Click 'Open' in the security dialog"
else
    echo "❌ Error: Failed to remove quarantine"
    echo ""
    echo "Alternative solution:"
    echo "  1. Right-click on FeedChecker.app"
    echo "  2. Select 'Open'"
    echo "  3. Click 'Open' in the security dialog"
    exit 1
fi

