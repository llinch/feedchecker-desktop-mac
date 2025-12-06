# Установка FeedChecker Desktop

## Требования

- Windows 10/11
- Node.js 18+ ([скачать](https://nodejs.org/))
- Python 3.11+ ([скачать](https://www.python.org/downloads/))

## Быстрая установка

1. **Клонируйте или скачайте проект**

2. **Настройте проект** (выполните один раз):
   ```powershell
   cd feedchecker-desktop
   .\setup.ps1
   ```

3. **Установите зависимости**:
   ```powershell
   # Зависимости Electron
   npm install
   
   # Зависимости фронтенда
   cd renderer
   npm install
   cd ..
   
   # Зависимости Python бэкенда
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

4. **Запустите приложение**:
   ```powershell
   npm run dev
   ```

## Сборка установщика

Для создания установщика Windows:

```powershell
npm run build
```

Установщик будет в папке `dist/`.

## Структура проекта

```
feedchecker-desktop/
├── main/              # Electron main process
│   ├── index.js      # Главный процесс
│   └── preload.js    # Preload скрипт
├── renderer/          # React фронтенд
│   └── src/          # Исходники фронтенда
├── backend/           # Python бэкенд
│   └── app/          # Исходники бэкенда
└── package.json       # Конфигурация Electron
```

## Решение проблем

### Бэкенд не запускается

Убедитесь, что Python установлен и доступен в PATH:
```powershell
python --version
```

### Порт 8000 занят

Измените порт в `main/index.js`:
```javascript
const BACKEND_PORT = 8001; // или другой свободный порт
```

### Ошибки при сборке

Убедитесь, что все зависимости установлены:
```powershell
npm install
cd renderer && npm install && cd ..
cd backend && pip install -r requirements.txt && cd ..
```


