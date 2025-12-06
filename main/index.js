const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess = null;
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// Определяем путь к Python бэкенду
function getBackendPath() {
  if (app.isPackaged) {
    // В собранном приложении
    return path.join(process.resourcesPath, 'backend');
  } else {
    // В режиме разработки
    return path.join(__dirname, '..', 'backend');
  }
}

// Определяем путь к Python
function getPythonPath() {
  if (app.isPackaged) {
    // В собранном приложении - сначала пробуем встроенный Python
    // Проверяем несколько возможных путей для портативной версии
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const pythonExe = isWindows ? 'python.exe' : 'python';
    
    const possiblePaths = [
      // В resources (стандартный путь)
      path.join(process.resourcesPath, 'python', pythonExe),
      // В виртуальном окружении (macOS)
      path.join(process.resourcesPath, 'python', 'bin', 'python'),
      // Рядом с exe (портативная версия Windows)
      path.join(path.dirname(process.execPath), 'resources', 'python', pythonExe),
      // Рядом с app (портативная версия macOS)
      path.join(path.dirname(process.execPath), '..', 'Resources', 'python', 'bin', 'python'),
      path.join(path.dirname(process.execPath), 'resources', 'python', 'bin', 'python'),
    ];
    
    for (const pythonPath of possiblePaths) {
      if (fs.existsSync(pythonPath)) {
        console.log(`Found embedded Python at: ${pythonPath}`);
        return pythonPath;
      }
    }
    
    // Если встроенного нет, используем системный Python
    // Пробуем разные варианты
    const pythonVariants = isWindows ? ['python', 'python3', 'py'] : ['python3', 'python'];
    for (const variant of pythonVariants) {
      try {
        const { execSync } = require('child_process');
        execSync(`${variant} --version`, { stdio: 'ignore' });
        console.log(`Using system Python: ${variant}`);
        return variant;
      } catch (e) {
        // Продолжаем поиск
      }
    }
  }
  // В режиме разработки - пробуем разные варианты в зависимости от платформы
  const pythonVariants = process.platform === 'win32' 
    ? ['py', 'python', 'python3'] 
    : ['python3', 'python'];
  for (const variant of pythonVariants) {
    try {
      const { execSync } = require('child_process');
      execSync(`${variant} --version`, { stdio: 'ignore' });
      console.log(`Using Python: ${variant}`);
      return variant;
    } catch (e) {
      // Продолжаем поиск
    }
  }
  // Fallback
  return process.platform === 'win32' ? 'python' : 'python3';
}

// Проверка и установка зависимостей Python
function checkAndInstallDependencies() {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();
    const pythonPath = getPythonPath();
    const requirementsPath = path.join(backendPath, 'requirements.txt');
    const depsCheckFile = path.join(backendPath, '.dependencies_installed');
    
    // Если используется встроенный Python (портативная версия), зависимости уже установлены
    if (pythonPath.includes('resources') || pythonPath.includes('python.exe') || pythonPath.includes('python/bin/python')) {
      console.log('Using embedded Python, dependencies should be pre-installed');
      resolve(true);
      return;
    }
    
    // Проверяем, установлены ли уже зависимости
    if (fs.existsSync(depsCheckFile)) {
      console.log('Dependencies already installed, skipping check...');
      resolve(true);
      return;
    }
    
    if (!fs.existsSync(requirementsPath)) {
      console.warn('requirements.txt not found, skipping dependency check');
      resolve(false);
      return;
    }
    
    console.log('Checking Python dependencies...');
    
    // Проверяем наличие uvicorn (основной пакет)
    const { exec } = require('child_process');
    const checkCmd = `${pythonPath} -m pip show uvicorn`;
    
    exec(checkCmd, { cwd: backendPath }, (error, stdout, stderr) => {
      if (error || !stdout.includes('Name: uvicorn')) {
        // Зависимости не установлены - устанавливаем автоматически
        console.log('Dependencies not found, installing automatically...');
        installDependencies(pythonPath, backendPath, requirementsPath, depsCheckFile)
          .then(() => resolve(true))
          .catch((err) => {
            console.error('Failed to install dependencies automatically:', err);
            // Не блокируем запуск, но показываем предупреждение
            if (mainWindow) {
              mainWindow.webContents.send('backend-warning', 
                'Не удалось автоматически установить зависимости Python. ' +
                'Пожалуйста, запустите install-dependencies.bat из папки приложения.'
              );
            }
            resolve(false);
          });
      } else {
        // Зависимости установлены
        console.log('Dependencies are installed');
        // Создаем маркерный файл
        try {
          fs.writeFileSync(depsCheckFile, new Date().toISOString());
        } catch (e) {
          // Игнорируем ошибку записи маркера
        }
        resolve(true);
      }
    });
  });
}

// Установка зависимостей
function installDependencies(pythonPath, backendPath, requirementsPath, depsCheckFile) {
  return new Promise((resolve, reject) => {
    console.log(`Installing dependencies using ${pythonPath}...`);
    
    // Показываем уведомление пользователю
    if (mainWindow) {
      mainWindow.webContents.send('backend-info', 
        'Установка зависимостей Python... Это может занять несколько минут.'
      );
    }
    
    // Обновляем pip и устанавливаем wheel
    const { exec } = require('child_process');
    exec(`${pythonPath} -m pip install --upgrade pip wheel --quiet`, 
      { cwd: backendPath, timeout: 60000 },
      (error) => {
        if (error) {
          console.warn('Failed to upgrade pip, continuing anyway...');
        }
        
        // Устанавливаем зависимости с предпочтением бинарных пакетов
        const installCmd = `${pythonPath} -m pip install --prefer-binary -r "${requirementsPath}"`;
        console.log(`Installing dependencies...`);
        
        const installProcess = exec(installCmd, 
          { 
            cwd: backendPath,
            maxBuffer: 10 * 1024 * 1024, // 10MB буфер для больших выводов
            timeout: 300000 // 5 минут таймаут
          }, 
          (error, stdout, stderr) => {
            if (error) {
              // Пробуем без --prefer-binary
              console.log('Retrying without --prefer-binary...');
              exec(`${pythonPath} -m pip install -r "${requirementsPath}"`, 
                { 
                  cwd: backendPath,
                  maxBuffer: 10 * 1024 * 1024,
                  timeout: 300000
                },
                (error2, stdout2, stderr2) => {
                  if (error2) {
                    console.error('Failed to install dependencies:', error2.message);
                    if (mainWindow) {
                      mainWindow.webContents.send('backend-error', 
                        `Не удалось установить зависимости автоматически.\n\n` +
                        `Ошибка: ${error2.message}\n\n` +
                        `Пожалуйста, запустите install-dependencies.bat из папки приложения вручную.`
                      );
                    }
                    reject(error2);
                  } else {
                    // Создаем маркерный файл
                    try {
                      fs.writeFileSync(depsCheckFile, new Date().toISOString());
                    } catch (e) {
                      // Игнорируем ошибку
                    }
                    console.log('✅ Dependencies installed successfully!');
                    if (mainWindow) {
                      mainWindow.webContents.send('backend-info', 
                        'Зависимости установлены успешно! Запускаем бэкенд...'
                      );
                    }
                    resolve();
                  }
                }
              );
            } else {
              // Создаем маркерный файл
              try {
                fs.writeFileSync(depsCheckFile, new Date().toISOString());
              } catch (e) {
                // Игнорируем ошибку
              }
              console.log('✅ Dependencies installed successfully!');
              if (mainWindow) {
                mainWindow.webContents.send('backend-info', 
                  'Зависимости установлены успешно! Запускаем бэкенд...'
                );
              }
              resolve();
            }
          }
        );
        
        // Показываем прогресс установки
        installProcess.stdout.on('data', (data) => {
          const output = data.toString();
          // Логируем важные сообщения
          if (output.includes('Successfully installed') || 
              output.includes('Requirement already satisfied') ||
              output.includes('Collecting')) {
            console.log(output.trim());
          }
        });
        
        installProcess.stderr.on('data', (data) => {
          const output = data.toString();
          // Логируем только ошибки, не предупреждения
          if (output.includes('ERROR') || output.includes('error:') || 
              (!output.includes('WARNING') && !output.includes('DEPRECATION'))) {
            console.log(output.trim());
          }
        });
      }
    );
  });
}

// Запуск бэкенда
function startBackend() {
  const backendPath = getBackendPath();
  const pythonPath = getPythonPath();
  const mainPy = path.join(backendPath, 'app', 'main.py');

  // Логируем только в dev режиме или при ошибках
  if (!app.isPackaged) {
    console.log(`Starting backend: ${pythonPath} -m uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`);
    console.log(`Backend path: ${backendPath}`);
    console.log(`Python path: ${pythonPath}`);
  }

  // Проверяем существование путей
  if (!fs.existsSync(backendPath)) {
    const errorMsg = `Backend path does not exist: ${backendPath}`;
    console.error(errorMsg);
    if (mainWindow) {
      mainWindow.webContents.send('backend-error', errorMsg);
    }
    return;
  }

  if (!fs.existsSync(mainPy)) {
    const errorMsg = `Main.py not found at: ${mainPy}`;
    console.error(errorMsg);
    if (mainWindow) {
      mainWindow.webContents.send('backend-error', errorMsg);
    }
    return;
  }

  // Устанавливаем рабочую директорию
  try {
    process.chdir(backendPath);
  } catch (error) {
    console.error(`Failed to change directory to ${backendPath}:`, error);
  }

  // Используем shell: true для Windows, чтобы команда 'python' работала
  // Для macOS/Linux используем shell только если путь не содержит разделителей (системная команда)
  const useShell = (process.platform === 'win32' && !pythonPath.includes(path.sep)) ||
                   ((process.platform === 'darwin' || process.platform === 'linux') && !pythonPath.includes('/'));
  
  backendProcess = spawn(pythonPath, [
    '-m', 'uvicorn',
    'app.main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT)
  ], {
    cwd: backendPath,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    },
    shell: useShell
  });

  backendProcess.stdout.on('data', (data) => {
    const output = data.toString();
    // Логируем stdout всегда, но в production только ошибки
    if (!app.isPackaged) {
      console.log(`Backend stdout: ${output}`);
    } else {
      // В production логируем только важные сообщения
      if (output.includes('ERROR') || output.includes('error') || output.includes('Exception')) {
        console.error(`Backend stdout: ${output}`);
      }
    }
  });

  backendProcess.stderr.on('data', (data) => {
    const errorMsg = data.toString();
    // В production тоже логируем ошибки
    console.error(`Backend stderr: ${errorMsg}`);
    if (mainWindow) {
      mainWindow.webContents.send('backend-error', errorMsg);
    }
  });

  backendProcess.on('close', (code) => {
    // Логируем только при ошибках
    if (code !== 0 && code !== null) {
      console.error(`Backend failed to start. Exit code: ${code}`);
      if (mainWindow) {
        mainWindow.webContents.send('backend-error', `Backend process exited with code ${code}. Check console for details.`);
      }
    }
    backendProcess = null;
  });

  backendProcess.on('error', (error) => {
    const errorMsg = `Failed to start backend: ${error.message}\nPython path: ${pythonPath}\nBackend path: ${backendPath}\n\nPossible causes:\n1. Python is not installed or not in PATH\n2. Python dependencies are not installed (run: pip install -r requirements.txt)\n3. Port 8000 is already in use`;
    console.error('='.repeat(80));
    console.error('BACKEND STARTUP ERROR:');
    console.error(errorMsg);
    console.error('Full error:', error);
    console.error('='.repeat(80));
    if (mainWindow) {
      mainWindow.webContents.send('backend-error', errorMsg);
    }
  });
}

// Остановка бэкенда
function stopBackend() {
  if (backendProcess) {
    // Логируем только в dev режиме
    if (!app.isPackaged) {
      console.log('Stopping backend...');
    }
    backendProcess.kill();
    backendProcess = null;
  }
}

// Создание главного окна
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  // Загружаем приложение
  if (app.isPackaged) {
    // В production - загружаем собранный фронтенд
    // Используем app.getAppPath() для правильного пути в asar
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'renderer', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
    // DevTools не открываем в production по умолчанию
    // Но можно открыть через Ctrl+Shift+I для отладки
  } else {
    // В development - загружаем Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }
  
  // Добавляем горячую клавишу для открытия DevTools в production (для отладки)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Обработка ошибок загрузки (логируем только ошибки)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', validatedURL);
    console.error('Error code:', errorCode);
    console.error('Error description:', errorDescription);
  });

  // Убрали логирование успешной загрузки
}

// IPC handlers
ipcMain.handle('get-backend-url', () => {
  return BACKEND_URL;
});

ipcMain.handle('check-backend-health', async () => {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
});

// Обработка закрытия приложения
app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('ready', async () => {
  // Логируем только в dev режиме
  if (!app.isPackaged) {
    console.log('App ready, checking dependencies...');
  }
  
  // Проверяем и устанавливаем зависимости (только в production)
  if (app.isPackaged) {
    try {
      await checkAndInstallDependencies();
    } catch (error) {
      console.error('Error checking dependencies:', error);
    }
  }
  
  // В dev режиме бэкенд запускается отдельно через npm run dev:backend
  // Не запускаем его здесь, чтобы избежать конфликта портов
  if (app.isPackaged) {
    // В production запускаем бэкенд сами
    console.log('Starting backend...');
    startBackend();
    
    // Ждем немного перед созданием окна, чтобы бэкенд успел запуститься
    setTimeout(() => {
      createWindow();
    }, 2000);
  } else {
    // В dev режиме просто создаем окно, бэкенд уже запущен отдельно
    console.log('Dev mode: backend should be running separately via npm run dev:backend');
    createWindow();
  }
});

app.on('before-quit', () => {
  stopBackend();
});


