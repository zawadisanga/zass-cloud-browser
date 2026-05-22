# Procfile - Hii inaamua jinsi dynos zinaanza
web:    backend/go-proxy/proxy -port=${PORT:-8080}
worker: node backend/browser-workers/worker-1/index.js
api:    node backend/api-server/app.js
cache:  redis-server --port 6379
