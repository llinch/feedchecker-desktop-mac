# Сборка портативной версии с помощью Docker

## Преимущества Docker-сборки

✅ **Единообразие** - одинаковая сборка на любой ОС  
✅ **Изоляция** - не влияет на систему разработчика  
✅ **Воспроизводимость** - всегда одинаковый результат  
✅ **Кроссплатформенность** - можно собрать на Windows для Windows, на Mac для Mac  

## Как это работает

1. **Docker собирает:**
   - Frontend (React приложение)
   - Python зависимости (устанавливает в виртуальное окружение)

2. **На хосте собирается:**
   - Electron приложение (требует целевую ОС)

## Требования

- Docker Desktop (установлен и запущен)
- Node.js 18+ (для сборки Electron)
- Интернет-соединение

## Сборка

### Windows

```powershell
npm run build:portable:docker
```

Или напрямую:
```powershell
powershell -ExecutionPolicy Bypass -File build-with-docker.ps1
```

### macOS/Linux

```bash
npm run build:portable:docker:mac
```

Или напрямую:
```bash
bash build-with-docker.sh
```

## Что делает скрипт

1. **Проверяет Docker** - убеждается, что Docker запущен
2. **Собирает в Docker:**
   - Frontend (React → статические файлы)
   - Python виртуальное окружение с зависимостями
3. **Экспортирует артефакты** из Docker контейнера
4. **Собирает Electron** на хосте (используя собранный frontend)
5. **Подготавливает Python** для портативной версии
6. **Копирует зависимости** из Docker-сборки
7. **Собирает финальную портативную версию**

## Структура Docker-сборки

```
Dockerfile.build (multi-stage):
├── Stage 1: Frontend Builder
│   └── Собирает React приложение
├── Stage 2: Python Builder  
│   └── Создает виртуальное окружение с зависимостями
└── Stage 3: Final
    └── Экспортирует все артефакты
```

## Результат

Портативная версия в папке `portable/`:
- ✅ Собранный frontend из Docker
- ✅ Python зависимости из Docker
- ✅ Electron приложение, собранное на хосте
- ✅ Готова к распространению

## Отладка

Если что-то пошло не так:

1. **Проверьте Docker:**
   ```bash
   docker --version
   docker ps
   ```

2. **Проверьте логи сборки:**
   ```bash
   docker-compose -f docker-compose.build.yml build --no-cache
   ```

3. **Проверьте экспортированные артефакты:**
   ```bash
   ls -la docker-build-output/
   ```

4. **Очистите и пересоберите:**
   ```bash
   docker-compose -f docker-compose.build.yml down
   docker system prune -a  # Осторожно! Удалит все неиспользуемые образы
   ```

## Сравнение с обычной сборкой

| Аспект | Обычная сборка | Docker сборка |
|--------|---------------|---------------|
| Требования | Node.js, Python на хосте | Docker, Node.js |
| Изоляция | Использует системные пакеты | Полная изоляция |
| Воспроизводимость | Зависит от системы | Всегда одинаковая |
| Скорость | Быстрее (нет Docker overhead) | Немного медленнее |
| Кроссплатформенность | Нужна целевая ОС | Frontend/Python - да, Electron - нет |

## Важные замечания

⚠️ **Electron все равно требует целевую ОС!**

Docker может собрать:
- ✅ Frontend (React)
- ✅ Python зависимости

Но **не может** собрать:
- ❌ Electron приложение для другой ОС (нужна целевая ОС)

Поэтому:
- На Windows можно собрать только Windows версию
- На macOS можно собрать только macOS версию
- Но frontend и Python зависимости будут одинаковые!

## Использование в CI/CD

Пример для GitHub Actions:

```yaml
name: Build Portable with Docker

on:
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install Docker
        run: |
          # Docker уже установлен в GitHub Actions
      - name: Build portable
        run: npm run build:portable:docker
      - uses: actions/upload-artifact@v3
        with:
          name: portable-windows
          path: portable/

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Build portable
        run: npm run build:portable:docker:mac
      - uses: actions/upload-artifact@v3
        with:
          name: portable-macos
          path: portable/
```

## FAQ

**Q: Можно ли собрать macOS версию на Windows через Docker?**  
A: Нет, Electron требует целевую ОС. Но frontend и Python зависимости будут собраны одинаково.

**Q: Зачем тогда Docker?**  
A: Для единообразия сборки frontend и Python зависимостей, изоляции, и возможности использовать в CI/CD.

**Q: Что быстрее - обычная сборка или Docker?**  
A: Обычная сборка немного быстрее, но Docker дает больше гарантий воспроизводимости.

**Q: Можно ли использовать только Docker без Electron?**  
A: Да! Можно собрать только backend и frontend, и запускать их в Docker контейнерах (см. `backend/Dockerfile` и `renderer/Dockerfile`).

