# Dockerfile - Multi-stage kwa best performance
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    golang-go \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy go code and build
COPY backend/go-proxy/ ./go-proxy/
WORKDIR /build/go-proxy
RUN go mod download && go build -o /usr/local/bin/proxy .

# Copy node code
WORKDIR /build
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY package*.json ./
RUN npm ci --production

# Final stage
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    redis-server \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/proxy /usr/local/bin/
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/backend /app/backend
COPY --from=builder /build/frontend /app/frontend
COPY config/supervisord.conf /etc/supervisor/conf.d/
COPY config/nginx.conf /etc/nginx/nginx.conf

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080 3001 3002 3003 5000

CMD ["supervisord", "-n"]
