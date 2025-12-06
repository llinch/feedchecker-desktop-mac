@echo off
echo ========================================
echo FeedChecker - Install Python Dependencies (Safe Mode)
echo ========================================
echo.
echo This script will install dependencies using pre-compiled packages
echo to avoid compilation issues on Windows.
echo.

REM Определяем путь к бэкенду
set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%resources\backend"

REM Проверяем существование папки бэкенда
if not exist "%BACKEND_DIR%" (
    echo ERROR: Backend directory not found at: %BACKEND_DIR%
    echo.
    echo Please run this script from the FeedChecker installation directory.
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

REM Обновляем pip
echo Updating pip...
%PYTHON_CMD% -m pip install --upgrade pip --quiet

REM Устанавливаем wheel
echo Installing wheel...
%PYTHON_CMD% -m pip install wheel --quiet

REM Устанавливаем зависимости по одной, используя только бинарные пакеты
echo.
echo Installing dependencies (this may take a few minutes)...
echo.

%PYTHON_CMD% -m pip install --only-binary :all: fastapi==0.115.0
%PYTHON_CMD% -m pip install --only-binary :all: uvicorn[standard]==0.32.0
%PYTHON_CMD% -m pip install --only-binary :all: python-multipart==0.0.12
%PYTHON_CMD% -m pip install --only-binary :all: lxml==5.3.0

REM Для pandas используем версию с готовыми wheel для Windows
echo Installing pandas (this may take longer)...
%PYTHON_CMD% -m pip install --only-binary :all: pandas==2.1.4
if errorlevel 1 (
    echo Trying alternative pandas version...
    %PYTHON_CMD% -m pip install --only-binary :all: pandas==2.0.3
)

%PYTHON_CMD% -m pip install --only-binary :all: openpyxl==3.1.5
%PYTHON_CMD% -m pip install pymorphy3==2.0.2
%PYTHON_CMD% -m pip install treelib==1.7.0
%PYTHON_CMD% -m pip install requests==2.32.3
%PYTHON_CMD% -m pip install pydantic==2.9.2
%PYTHON_CMD% -m pip install pydantic-settings==2.6.0
%PYTHON_CMD% -m pip install python-dotenv==1.0.1
%PYTHON_CMD% -m pip install aiofiles==24.1.0
%PYTHON_CMD% -m pip install brotli==1.1.0

echo.
echo ========================================
echo Installation completed!
echo ========================================
echo.
echo Verifying installation...
%PYTHON_CMD% -m pip show uvicorn >nul 2>&1
if errorlevel 1 (
    echo WARNING: Some packages may not be installed correctly
) else (
    echo All packages installed successfully!
)
pause





