# TG Mini App — Новости и цены

Телеграм-мини-приложение с двумя вкладками:
- **Новости** — статические карточки новостей
- **Цены** — подвкладки «Жильё» и «Другое» с предложениями
- **Курс валют** — виджет myfin.by (Гомель) через iframe

## Стек

- Фронтенд: React + Vite + TypeScript, `@telegram-apps/sdk`
- Бэкенд: Node.js + Express (заготовка, деплой на Render)
- База: Supabase (подключение готово, данные сейчас статические)

## Структура

```
my-tg-mini-app/
├── client/          # React + Vite фронтенд
├── server/          # Node.js бэкенд (Express)
├── shared/          # общие типы/константы (пока пусто)
├── render.yaml      # конфиг деплоя на Render
└── README.md
```

## Локальный запуск

### Фронтенд
```bash
cd client
npm install
npm run dev      # http://localhost:5173
```

### Бэкенд
```bash
cd server
npm install
cp .env.example .env
npm start        # http://localhost:3000
```

## Виджет курса

Подключён через `<iframe src="https://myfin.by/currency/gomel">` — отображает курс валют для региона Гомель напрямую с сайта myfin.by.
# tg-app
