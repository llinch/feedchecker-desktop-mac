# FeedChecker Backend

FastAPI сервер для проверки и валидации XML/YML фидов товаров.

## Установка

```bash
# Создание виртуального окружения
python3 -m venv venv

# Активация виртуального окружения
source venv/bin/activate  # для macOS/Linux
# или
venv\Scripts\activate  # для Windows

# Установка зависимостей
pip install -r requirements.txt
```

## Запуск

```bash
# Запуск в режиме разработки с автоперезагрузкой
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Или из корня монорепо
npm run dev:backend
```

API будет доступен по адресу: http://localhost:8000

## Документация API

После запуска сервера документация доступна по адресам:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## API Endpoints

### `POST /api/check-feed`
Полная проверка фида

**Параметры:**
- `site_id` (int): ID сайта
- `feed_url` (string, optional): URL фида
- `feed_file` (file, optional): Загружаемый файл фида

**Ответ:**
```json
{
  "site_id": 123,
  "syntax": {
    "valid": true,
    "message": "XML well formed, syntax ok."
  },
  "mandatory": {
    "total_offers": 1000,
    "available_offers": 950,
    "unavailable_offers": 50,
    "total_categories": 200,
    "category_tree_depth": 5,
    "brands_count": 50,
    "problems": {
      "missing_id": 0,
      "missing_availability": 0,
      "missing_name": 0,
      "missing_link": 0,
      "price_issues": 5,
      "missing_category": 0,
      "invalid_category": 0,
      "multiple_categories": 0,
      "vendor_issues": 10,
      "missing_image": 2
    },
    "duplicate_ids": []
  },
  "categories": {
    "empty_categories": [],
    "duplicated_categories": [],
    "dual_categories": []
  }
}
```

### `POST /api/check-syntax`
Проверка только синтаксиса XML

**Параметры:**
- `site_id` (int): ID сайта
- `feed_url` (string, optional): URL фида
- `feed_file` (file, optional): Загружаемый файл фида

**Ответ:**
```json
{
  "valid": true,
  "message": "XML well formed, syntax ok."
}
```

### `POST /api/get-problematic-offers`
Получение списка проблемных товаров

**Параметры:**
- `site_id` (int): ID сайта
- `feed_url` (string, optional): URL фида
- `feed_file` (file, optional): Загружаемый файл фида
- `problem_type` (string): Тип проблемы

**Типы проблем:**
- `MISSING_ID`
- `MISSING_AVAILABLE`
- `MISSING_NAME`
- `MISSING_LINK`
- `PRICE_ISSUES`
- `MISSING_CATEGORY`
- `INVALID_CATEGORY`
- `MULTIPLE_CATEGORIES`
- `MISSING_VENDOR`
- `MISSING_IMAGE`

**Ответ:**
```json
{
  "problem_type": "PRICE_ISSUES",
  "count": 5,
  "offers": [
    {
      "id": "12345",
      "name": "Товар без цены",
      "url": "https://example.com/product/12345",
      "price": "Цена отсутствует"
    }
  ]
}
```

## Структура проекта

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI приложение
│   ├── feed_checker.py      # Класс для проверки фидов
│   ├── routes/              # API роуты
│   └── models/              # Pydantic модели
├── requirements.txt         # Python зависимости
└── README.md
```

## Технологии

- Python 3.10+
- FastAPI - веб-фреймворк
- lxml - парсинг XML
- pandas - обработка данных
- requests - HTTP запросы
- uvicorn - ASGI сервер

