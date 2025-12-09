# Сборка портативной версии для macOS

## Варианты сборки

### Вариант 1: Сборка на macOS (рекомендуется)

Если у вас есть доступ к Mac, вы можете собрать портативную версию прямо на нем:

1. **Установите зависимости:**
   ```bash
   # Установите Node.js (если еще не установлен)
   brew install node
   
   # Установите Python 3.11 (если еще не установлен)
   brew install python@3.11
   ```

2. **Клонируйте проект и установите зависимости:**
   ```bash
   cd feedchecker-desktop
   npm install
   cd renderer && npm install && cd ..
   ```

3. **Соберите портативную версию:**
   ```bash
   npm run build:portable:mac
   ```

   Или напрямую:
   ```bash
   bash build-portable.sh
   ```

4. **Результат:**
   Портативная версия будет в папке `portable/`. Пользователи могут просто скопировать эту папку и запустить `FeedChecker.app`.

### Вариант 2: Использование CI/CD (GitHub Actions)

Если у вас нет доступа к Mac, можно настроить автоматическую сборку через GitHub Actions:

1. Создайте файл `.github/workflows/build-macos.yml`:
   ```yaml
   name: Build macOS Portable
   
   on:
     workflow_dispatch:
   
   jobs:
     build:
       runs-on: macos-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with:
             node-version: '18'
         - uses: actions/setup-python@v4
           with:
             python-version: '3.11'
         - run: npm install
         - run: cd renderer && npm install && cd ..
         - run: npm run build:portable:mac
         - uses: actions/upload-artifact@v3
           with:
             name: portable-macos
             path: portable/
   ```

2. Запустите workflow в GitHub Actions, и он соберет портативную версию для macOS.

### Вариант 3: Использование виртуальной машины macOS

Если у вас есть лицензия на macOS, можно использовать виртуальную машину (VMware, VirtualBox, Parallels) для сборки.

### Вариант 4: Использование облачных Mac-сервисов

Существуют сервисы, предоставляющие доступ к Mac в облаке:
- [MacStadium](https://www.macstadium.com/)
- [MacinCloud](https://www.macincloud.com/)
- [AWS EC2 Mac instances](https://aws.amazon.com/ec2/instance-types/mac/)

## Что делает скрипт сборки

1. **Проверяет зависимости:** Node.js и Python
2. **Собирает фронтенд:** запускает `npm run build` в папке `renderer`
3. **Собирает Electron приложение:** создает `.app` bundle для macOS
4. **Создает Python виртуальное окружение:** устанавливает Python 3.11 и все зависимости
5. **Копирует файлы:** собирает все в папку `portable/`
6. **Создает README:** добавляет инструкции для пользователей

## Структура портативной версии

```
portable/
├── FeedChecker.app/          # Electron приложение
│   └── Contents/
│       ├── MacOS/
│       │   └── FeedChecker    # Исполняемый файл
│       └── Resources/
│           ├── python/        # Python виртуальное окружение
│           └── backend/        # Backend код
├── README.txt                 # Инструкции
└── fix-macos-gatekeeper.sh    # Скрипт для исправления Gatekeeper
```

## Требования для пользователей

- macOS 10.13 (High Sierra) или новее
- Ничего больше не требуется!

## Примечания

- При первом запуске macOS может запросить разрешение на запуск приложения

## Решение проблемы "App is damaged"

Если macOS показывает ошибку "FeedChecker.app is damaged and should be moved to the Trash", это предупреждение Gatekeeper о неподписанном приложении.

### Решение 1: Использовать скрипт (рекомендуется)

В папке `portable/` есть скрипт `fix-macos-gatekeeper.sh`. Запустите его:
```bash
cd portable
./fix-macos-gatekeeper.sh
```

### Решение 2: Удалить карантин вручную

Откройте Terminal и выполните:
```bash
cd /path/to/portable
xattr -cr FeedChecker.app
```

### Решение 3: Правой кнопкой мыши

1. Правой кнопкой мыши (или Control+click) на `FeedChecker.app`
2. Выберите "Open" (Открыть)
3. Нажмите "Open" в диалоге безопасности
4. Приложение будет добавлено в исключения безопасности

### Решение 4: Настройки системы

1. Откройте System Settings > Privacy & Security
2. Прокрутите вниз до раздела "Security"
3. Если видите сообщение о FeedChecker, нажмите "Open Anyway"

## Размер

Примерно 200-300 МБ (включая Python и все зависимости)

## Обновление

Для обновления просто замените всю папку `portable/` новой версией.



