# FeedChecker Frontend

Веб-интерфейс для проверки и валидации XML/YML фидов товаров.

## Технологии

- React 18 + TypeScript
- Vite - сборщик и dev сервер
- shadcn/ui - UI компоненты
- TailwindCSS - стилизация
- React Router - роутинг
- Lucide React - иконки

## Установка

```bash
# Установка зависимостей
npm install

# Копирование .env файла
cp .env.example .env
```

## Конфигурация

Создайте файл `.env` и укажите URL бэкенда:

```env
VITE_API_URL=http://localhost:8000
```

## Запуск

```bash
# Запуск dev сервера
npm run dev

# Или из корня монорепо
npm run dev:frontend
```

Приложение будет доступно по адресу: http://localhost:5173

## Сборка

```bash
# Production сборка
npm run build

# Предпросмотр production сборки
npm run preview
```

## Структура проекта

```
frontend/
├── src/
│   ├── components/
│   │   └── ui/              # shadcn/ui компоненты
│   ├── pages/
│   │   ├── Home.tsx         # Главная страница (форма ввода)
│   │   └── Results.tsx      # Страница результатов
│   ├── services/
│   │   └── api.ts           # API клиент для backend
│   ├── types/
│   │   └── feed.ts          # TypeScript типы
│   ├── lib/
│   │   └── utils.ts         # Утилиты
│   ├── App.tsx              # Главный компонент с роутингом
│   ├── main.tsx             # Точка входа
│   └── index.css            # Глобальные стили
├── index.html
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Страницы

### Home (`/`)
Главная страница с формой для запуска проверки:
- Ввод Site ID
- Выбор источника фида (URL или файл)
- Запуск проверки

### Results (`/results`)
Страница с результатами проверки:
- Общая статистика (товары, категории, бренды)
- Вкладки с детальной информацией:
  - Проблемы товаров
  - Проблемы категорий
  - Дубликаты ID

## API Integration

Frontend взаимодействует с Backend через REST API:

```typescript
import { feedCheckerAPI } from "@/services/api"

// Проверка фида
const result = await feedCheckerAPI.checkFeed(siteId, feedUrl, feedFile)

// Проверка синтаксиса
const syntax = await feedCheckerAPI.checkSyntax(siteId, feedUrl, feedFile)

// Получение проблемных товаров
const offers = await feedCheckerAPI.getProblematicOffers(
  siteId,
  "MISSING_ID",
  feedUrl,
  feedFile
)
```

## Доступные компоненты UI

Проект использует shadcn/ui компоненты:

- **Layout**: Card, Separator, ScrollArea, Tabs
- **Forms**: Input, Label, Button
- **Feedback**: Alert, Badge, Progress
- **Data Display**: Table, Avatar
- **Overlay**: Dialog, Sheet, Popover, Tooltip

Все компоненты расположены в `src/components/ui/`

## Разработка

### Добавление новой страницы

1. Создайте компонент в `src/pages/`
2. Добавьте роут в `src/App.tsx`
3. Добавьте типы в `src/types/` при необходимости

### Работа с API

Все API запросы должны идти через `src/services/api.ts`:

```typescript
export class FeedCheckerAPI {
  async yourNewMethod() {
    // ...
  }
}
```

### Добавление UI компонента

Используйте shadcn/ui CLI для добавления новых компонентов:

```bash
npx shadcn-ui@latest add [component-name]
```

## Troubleshooting

### Ошибка подключения к API

Убедитесь что:
1. Backend запущен на порту 8000
2. В `.env` правильно указан `VITE_API_URL`
3. CORS настроен в backend

### Проблемы с типами

Проверьте импорты типов из `@/types/feed`:

```typescript
import type { FeedCheckResult } from "@/types/feed"
```
