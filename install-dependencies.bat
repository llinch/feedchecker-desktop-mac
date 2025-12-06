@echo off
echo ========================================
echo FeedChecker - Install Python Dependencies
echo ========================================
echo.

REM Определяем путь к бэкенду
set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%resources\backend"

REM Проверяем существование папки бэкенда
if not exist "%BACKEND_DIR%" (
    echo ERROR: Backend directory not found at: %BACKEND_DIR%
    echo.
    echo Please run this script from the FeedChecker installation directory.
    echo Usually: C:\Users\YourName\AppData\Local\Programs\feedchecker-desktop\
    pause
    exit /b 1
)

REM Проверяем Python
echo Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    py --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python is not installed or not in PATH
        echo.
        echo Please install Python 3.11+ from https://www.python.org/downloads/
        echo Make sure to check "Add Python to PATH" during installation
        pause
        exit /b 1
    ) else (
        set "PYTHON_CMD=py"
    )
) else (
    set "PYTHON_CMD=python"
)

echo Python found: 
%PYTHON_CMD% --version
echo.

REM Переходим в папку бэкенда
cd /d "%BACKEND_DIR%"

REM Проверяем наличие requirements.txt
if not exist "requirements.txt" (
    echo ERROR: requirements.txt not found in %BACKEND_DIR%
    pause
    exit /b 1
)

echo Installing Python dependencies...
echo This may take a few minutes...
echo.

REM Обновляем pip
%PYTHON_CMD% -m pip install --upgrade pip

REM Устанавливаем wheel для предкомпилированных пакетов
%PYTHON_CMD% -m pip install wheel

echo.
echo Installing dependencies using pre-compiled packages (wheels)...
echo This avoids compilation issues on Windows.
echo.

REM Устанавливаем зависимости, предпочитая бинарные пакеты
%PYTHON_CMD% -m pip install --prefer-binary -r requirements.txt

if errorlevel 1 (
    echo.
    echo WARNING: Some packages failed to install with --prefer-binary
    echo Trying standard installation...
    %PYTHON_CMD% -m pip install -r requirements.txt
)

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    echo.
    echo Try running as Administrator or check your internet connection
    pause
    exit /b 1
)

echo.
echo ========================================
echo Installation completed successfully!
echo ========================================
echo.
echo You can now start FeedChecker application.
pause

