# Быстрый старт FeedChecker Desktop

## Первая настройка (один раз)

1. **Скопируйте файлы из any-feedchecker**:
   ```powershell
   cd feedchecker-desktop
   .\copy-files.ps1
   ```

2. **Установите зависимости**:
   ```powershell
   # Electron
   npm install
   
   # Фронтенд
   cd renderer
   npm install
   cd ..
   
   # Бэкенд
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

## Запуск приложения

```powershell
npm run dev
```

Это запустит:
- ✅ Electron окно
- ✅ Vite dev server (порт 5173)
- ✅ Python бэкенд (порт 8000)

## Сборка установщика

```powershell
npm run build
```

Установщик будет в `dist/FeedChecker Setup x.x.x.exe`

## Структура

```
feedchecker-desktop/
├── main/           # Electron (Node.js)
├── renderer/       # React фронтенд
├── backend/        # Python бэкенд
└── dist/           # Собранное приложение
```

## Примечания

- Бэкенд запускается автоматически при старте
- В dev режиме используется системный Python
- Для production можно встроить Python (PyInstaller)


