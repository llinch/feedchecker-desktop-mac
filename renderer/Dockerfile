# Frontend Dockerfile для FeedChecker (Production)

# Этап 1: Сборка приложения
FROM node:18-alpine AS builder

WORKDIR /app

# Аргумент для API URL (можно переопределить при сборке)
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

# Копирование package.json и package-lock.json
COPY package*.json ./

# Установка зависимостей
RUN npm ci

# Копирование исходного кода
COPY . .

# Сборка production версии
RUN npm run build

# Этап 2: Production сервер (nginx)
FROM nginx:1.27-alpine

# Копирование собранных файлов из builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Копирование конфигурации nginx для SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Открытие порта
EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Запуск nginx
CMD ["nginx", "-g", "daemon off;"]
