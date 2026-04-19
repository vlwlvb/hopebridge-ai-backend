# ai-support-backend 1.4.2

Backend для HopeBridge:
- AI chat support
- crisis-aware fallback replies
- optional speech-to-text transcription
- rate limiting
- CORS and Helmet hardening

## Быстрый старт
```bash
npm install
cp .env.example .env
npm run preflight
npm run dev
```

## Проверка
```text
GET /health
POST /chat-support
POST /transcribe
```

## Production
- backend должен работать только по HTTPS;
- `OPENAI_API_KEY` хранится только на сервере, не в мобильном приложении;
- `CORS_ORIGINS` должен содержать только твои production-домены;
- не логируй чувствительные сообщения пользователей;
- перед релизом проверь `GET /health` и реальный запрос на `/chat-support`.
